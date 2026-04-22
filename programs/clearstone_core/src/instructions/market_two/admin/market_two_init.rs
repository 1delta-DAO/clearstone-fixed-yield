use crate::{
    constants::{PROTOCOL_FEE_MAX_BPS, VIRTUAL_LP_FLOOR, VIRTUAL_PT, VIRTUAL_SY},
    cpi_common::CpiAccounts,
    error::ExponentCoreError,
    seeds::MARKET_SEED,
    utils::{cpi_init_sy_personal_account, do_deposit_sy},
    MarketTwo, Vault, ID,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::Token,
    token_2022::{self, MintTo, Transfer},
    token_interface::{Mint, TokenAccount},
};
use precise_number::Number;
use token_util::{create_associated_token_account_2022, create_mint_2022, create_token_account};

#[derive(Accounts)]
#[instruction(
    ln_fee_rate_root: f64,
    rate_scalar_root: f64,
    init_rate_anchor: f64,
    sy_exchange_rate: Number,
    pt_init: u64,
    sy_init: u64,
    fee_treasury_sy_bps: u16,
    cpi_accounts: CpiAccounts,
    seed_id: u8,
)]
pub struct MarketTwoInit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// There is 1 market per vault
    #[account(
        init,
        payer = payer,
        seeds = [
            MARKET_SEED,
            vault.key().as_ref(),
            &[seed_id],
        ],
        bump,
        space = MarketTwo::size_of(&cpi_accounts)
    )]
    pub market: Account<'info, MarketTwo>,

    /// Links the mint_sy & mint_pt & sy_program together
    #[account(
        has_one = mint_sy,
        has_one = mint_pt,
        has_one = sy_program
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(mut)]
    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,
    pub mint_pt: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: created & validated in handler
    #[account(mut)]
    pub mint_lp: UncheckedAccount<'info>,

    /// CHECK: created & validated in handler
    #[account(mut)]
    pub escrow_pt: UncheckedAccount<'info>,

    /// This account for SY is only a temporary pass-through account
    /// It is used to transfer SY tokens from the signer to the market
    /// And then from the market to the SY program's escrow
    /// CHECK: created and validated in handler
    #[account(mut)]
    pub escrow_sy: UncheckedAccount<'info>,

    /// Signer's PT token account
    #[account(mut)]
    pub pt_src: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Signer's SY token account
    #[account(mut)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Receiving account for LP tokens
    /// CHECK: created and validated in handler
    #[account(mut)]
    pub lp_dst: UncheckedAccount<'info>,

    /// Use the old Token program as the implementation for PT & SY & LP tokens
    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,

    /// CHECK: constrained by vault
    pub sy_program: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    /// CHECK: high trust instruction
    pub address_lookup_table: UncheckedAccount<'info>,

    #[account(
        token::mint = mint_sy,
    )]
    pub token_treasury_fee_sy: InterfaceAccount<'info, TokenAccount>,
}

impl<'i> MarketTwoInit<'i> {
    fn transfer_pt_accounts(&self) -> Transfer<'i> {
        Transfer {
            from: self.pt_src.to_account_info(),
            to: self.escrow_pt.to_account_info(),
            authority: self.payer.to_account_info(),
        }
    }

    fn transfer_sy_accounts(&self) -> Transfer<'i> {
        Transfer {
            from: self.sy_src.to_account_info(),
            to: self.escrow_sy.to_account_info(),
            authority: self.payer.to_account_info(),
        }
    }

    fn mint_lp_accounts(&self) -> MintTo<'i> {
        MintTo {
            mint: self.mint_lp.to_account_info(),
            to: self.lp_dst.to_account_info(),
            authority: self.market.to_account_info(),
        }
    }

    fn mint_lp_context(&self) -> CpiContext<'_, '_, '_, 'i, MintTo<'i>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            self.mint_lp_accounts(),
        )
    }

    fn transfer_pt_context(&self) -> CpiContext<'_, '_, '_, 'i, Transfer<'i>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            self.transfer_pt_accounts(),
        )
    }

    fn transfer_sy_context(&self) -> CpiContext<'_, '_, '_, 'i, Transfer<'i>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            self.transfer_sy_accounts(),
        )
    }

    fn do_transfer_pt(&self, amount: u64) -> Result<()> {
        #[allow(deprecated)]
        token_2022::transfer(self.transfer_pt_context(), amount)
    }

    fn do_transfer_sy(&self, amount: u64) -> Result<()> {
        #[allow(deprecated)]
        token_2022::transfer(self.transfer_sy_context(), amount)
    }

    fn do_mint_lp(&self, amount: u64) -> Result<()> {
        token_2022::mint_to(
            self.mint_lp_context()
                .with_signer(&[&self.market.signer_seeds()]),
            amount,
        )
    }

    fn create_lp_mint(&self) -> Result<()> {
        let decimals = self.mint_sy.decimals;
        let (addr, bump) =
            Pubkey::find_program_address(&[b"mint_lp", self.market.key().as_ref()], &ID);

        assert_eq!(addr, self.mint_lp.key());

        create_mint_2022(
            &self.market.to_account_info(),
            &self.payer.to_account_info(),
            &self.mint_lp.to_account_info(),
            &self.token_program.to_account_info(),
            &self.system_program.to_account_info(),
            decimals,
            &[&[b"mint_lp", self.market.key().as_ref(), &[bump]]],
        )
    }

    /// Generic function to create token accounts for the market
    fn create_market_token_account(
        &self,
        mint: &AccountInfo<'i>,
        token_account: &AccountInfo<'i>,
        seed: &[u8],
    ) -> Result<Pubkey> {
        let (addr, bump) = Pubkey::find_program_address(&[seed, self.market.key().as_ref()], &ID);
        assert_eq!(addr, token_account.key());

        create_token_account(
            &self.market.to_account_info(),
            &self.payer.to_account_info(),
            token_account,
            mint,
            &self.system_program.to_account_info(),
            &self.token_program.to_account_info(),
            &[&[seed, self.market.key().as_ref(), &[bump]]],
        )?;

        Ok(addr)
    }

    fn create_payer_lp_account(&self) -> Result<()> {
        create_associated_token_account_2022(
            &self.payer.to_account_info(),
            &self.payer.to_account_info(),
            &self.mint_lp.to_account_info(),
            &self.lp_dst.to_account_info(),
            &self.token_program.to_account_info(),
            &self.associated_token_program.to_account_info(),
            &self.system_program.to_account_info(),
        )
    }

    fn create_escrow_pt(&self) -> Result<Pubkey> {
        self.create_market_token_account(
            &self.mint_pt.to_account_info(),
            &self.escrow_pt.to_account_info(),
            b"escrow_pt",
        )
    }

    fn create_escrow_sy(&self) -> Result<Pubkey> {
        self.create_market_token_account(
            &self.mint_sy.to_account_info(),
            &self.escrow_sy.to_account_info(),
            b"escrow_sy",
        )
    }
}

/// Create a market struct from the raw arguments
pub fn make_market(
    ctx: &Context<MarketTwoInit>,
    ln_fee_rate_root: f64,
    rate_scalar_root: f64,
    init_rate_anchor: f64,
    sy_exchange_rate: Number,
    pt_init: u64,
    sy_init: u64,
    token_treasury_fee_sy: Pubkey,
    cpi_accounts: &CpiAccounts,
    fee_treasury_sy_bps: u16,
    seed_id: u8,
    curator: Pubkey,
    creator_fee_bps: u16,
) -> MarketTwo {
    let expiration_ts = (ctx.accounts.vault.start_ts + ctx.accounts.vault.duration) as u64;
    let mint_pt = ctx.accounts.mint_pt.key();
    let mint_sy = ctx.accounts.mint_sy.key();
    let vault = ctx.accounts.vault.key();
    let mint_lp = ctx.accounts.mint_lp.key();
    let token_escrow_sy = ctx.accounts.escrow_sy.key();
    let token_escrow_pt = ctx.accounts.escrow_pt.key();
    let sy_program = ctx.accounts.sy_program.key();

    MarketTwo::new(
        ctx.accounts.market.key(),
        [ctx.bumps.market],
        expiration_ts,
        ln_fee_rate_root,
        rate_scalar_root,
        init_rate_anchor,
        pt_init,
        sy_init,
        sy_exchange_rate,
        mint_pt,
        mint_sy,
        vault,
        mint_lp,
        token_escrow_pt,
        token_escrow_sy,
        ctx.accounts.address_lookup_table.key(),
        token_treasury_fee_sy,
        sy_program,
        cpi_accounts.clone(),
        fee_treasury_sy_bps,
        seed_id,
        curator,
        creator_fee_bps,
    )
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, MarketTwoInit<'info>>,
    // log of fee rate root
    ln_fee_rate_root: f64,

    // rate scalar root amount
    rate_scalar_root: f64,

    // initial rate anchor
    init_rate_anchor: f64,

    // exchange rate for SY into base asset
    sy_exchange_rate: Number,

    // initial amount of PT liquidity
    pt_init: u64,

    // initial amount of SY liquidity
    sy_init: u64,

    // fee treasury SY BPS
    fee_treasury_sy_bps: u16,

    // indexes for CPI account vectors
    cpi_accounts: CpiAccounts,

    // unique seed id for the market
    seed_id: u8,

    // curator for this market (all modify_* ixns gate on this key)
    curator: Pubkey,

    // immutable ceiling for fee_treasury_sy_bps (I-E1 / I-E2)
    creator_fee_bps: u16,
) -> Result<()> {
    // PLAN §6.2 init validations
    require!(
        creator_fee_bps <= PROTOCOL_FEE_MAX_BPS,
        ExponentCoreError::FeeExceedsProtocolCap
    );
    require!(
        fee_treasury_sy_bps <= creator_fee_bps,
        ExponentCoreError::FeeExceedsProtocolCap
    );

    // make the market account from a factory
    let market = make_market(
        &ctx,
        ln_fee_rate_root,
        rate_scalar_root,
        init_rate_anchor,
        sy_exchange_rate,
        pt_init,
        sy_init,
        ctx.accounts.token_treasury_fee_sy.key(),
        &cpi_accounts,
        fee_treasury_sy_bps,
        seed_id,
        curator,
        creator_fee_bps,
    );
    ctx.accounts.market.set_inner(market);

    ctx.accounts.create_lp_mint()?;

    // token account for holding PT liquidity
    ctx.accounts.create_escrow_pt()?;

    // token account for passing SY to the SY program and back
    ctx.accounts.create_escrow_sy()?;

    // create a token account for the receiver's LP tokens
    // we must do this in the instruction because the Mint is created in this instruction
    ctx.accounts.create_payer_lp_account()?;

    // transfer tokens from user to market
    ctx.accounts.do_transfer_pt(pt_init)?;
    ctx.accounts.do_transfer_sy(sy_init)?;

    // give user LP tokens in exchange
    ctx.accounts
        .do_mint_lp(calc_lp_tokens_out(pt_init, sy_init))?;

    // Create an account for the Market robot with the SY Program
    cpi_init_sy_personal_account(ctx.accounts.sy_program.key(), ctx.remaining_accounts)?;

    // Flush market state (just written above via set_inner) before the
    // guarded CPI so the latch byte can be read on-chain.
    {
        let market_info = ctx.accounts.market.to_account_info();
        let mut data = market_info.try_borrow_mut_data()?;
        let mut writer: &mut [u8] = &mut data;
        ctx.accounts.market.try_serialize(&mut writer)?;
    }

    do_deposit_sy(
        &ctx.accounts.market.to_account_info(),
        sy_init,
        &ctx.accounts.address_lookup_table,
        &ctx.accounts.market.cpi_accounts,
        &ctx.accounts.to_account_infos(),
        &ctx.remaining_accounts,
        ctx.accounts.sy_program.key(),
        &[&ctx.accounts.market.signer_seeds()],
    )?;
    ctx.accounts.market.reload()?;

    Ok(())
}

/// Initial LP mint — Morpho-Blue-style virtualized formula.
///
///     lp_out = sqrt((pt_in + VIRTUAL_PT) * (sy_in + VIRTUAL_SY)) - VIRTUAL_LP_FLOOR
///
/// The `- VIRTUAL_LP_FLOOR` term is the implicit "burned" floor that
/// participates in every subsequent proportional calculation but is never
/// held by any real account. It closes the classic first-LP sandwich hole
/// and the 1-wei donation attack. See PLAN §6.4.
///
/// Panics on overflow; callers validate pt_init/sy_init sizes.
pub(crate) fn calc_lp_tokens_out(pt_in: u64, sy_in: u64) -> u64 {
    let pt_v = (pt_in as u128).saturating_add(VIRTUAL_PT as u128);
    let sy_v = (sy_in as u128).saturating_add(VIRTUAL_SY as u128);
    let product = pt_v
        .checked_mul(sy_v)
        .expect("Overflow computing virtualized LP product");
    let total_virtual_lp = (product as f64).sqrt() as u64;
    total_virtual_lp.saturating_sub(VIRTUAL_LP_FLOOR)
}

#[cfg(test)]
mod tests {
    use super::calc_lp_tokens_out;
    use crate::constants::VIRTUAL_LP_FLOOR;

    /// Empty pool: no user LP minted. The `sqrt(VP*VS) - VIRTUAL_LP_FLOOR`
    /// cancels to zero because the constants are picked so that
    /// VIRTUAL_LP_FLOOR = sqrt(VIRTUAL_PT * VIRTUAL_SY). This is the
    /// first-LP sandwich protection: if someone "initializes" a market
    /// with zero liquidity and a second caller puts real liquidity in,
    /// the first caller got zero LP and cannot extract.
    #[test]
    fn zero_deposit_mints_zero_lp() {
        assert_eq!(calc_lp_tokens_out(0, 0), 0);
    }

    /// A 1-wei donation of PT or SY by itself must not mint any visible
    /// LP above the virtual floor. `sqrt((1+VP)*VS)` is within rounding
    /// of `sqrt(VP*VS)`.
    #[test]
    fn dust_deposit_mints_negligible_lp() {
        let lp_pt_dust = calc_lp_tokens_out(1, 0);
        let lp_sy_dust = calc_lp_tokens_out(0, 1);
        // Integer sqrt of VIRTUAL_PT * VIRTUAL_SY = sqrt(10^12) = 10^6 = VIRTUAL_LP_FLOOR.
        // sqrt(10^12 + 10^6) ≈ 10^6 + 0.5; floored back to 10^6 → 0 after subtraction.
        // We allow up to 1 unit of tolerance for f64-sqrt rounding.
        assert!(lp_pt_dust <= 1, "pt dust minted {} LP", lp_pt_dust);
        assert!(lp_sy_dust <= 1, "sy dust minted {} LP", lp_sy_dust);
    }

    /// Blue-style formula: user_lp + VIRTUAL_LP_FLOOR is what pro-rata math
    /// uses elsewhere. So the user's share of the pool is strictly less
    /// than 1 — the virtual floor holds `VIRTUAL_LP_FLOOR / (user_lp +
    /// VIRTUAL_LP_FLOOR)` of the pool forever.
    #[test]
    fn first_lp_share_is_strictly_less_than_one() {
        let pt = 1_000_000_000u64;
        let sy = 1_000_000_000u64;
        let lp = calc_lp_tokens_out(pt, sy);
        let virtual_total = lp + VIRTUAL_LP_FLOOR;
        // User's share should be < 100%.
        assert!(lp < virtual_total);
        // For reasonably-sized pools, the dilution is tiny (< 1 part per thousand here).
        assert!(
            VIRTUAL_LP_FLOOR * 1000 < virtual_total,
            "virtual floor dilution too large at this pool size"
        );
    }

    /// Large pools converge: for reserves >> virtual constants, LP ≈ geometric mean.
    #[test]
    fn large_pool_approximates_geometric_mean() {
        let pt = 10_u64.pow(15); // 10^15
        let sy = 10_u64.pow(15);
        let lp = calc_lp_tokens_out(pt, sy);
        let pure_geometric_mean = ((pt as f64) * (sy as f64)).sqrt() as u64;
        // Relative difference should be tiny: ~VIRTUAL_LP_FLOOR / 10^15.
        let diff = pure_geometric_mean.saturating_sub(lp);
        assert!(diff <= VIRTUAL_LP_FLOOR + 1);
    }

    /// Sandwich-attempt simulation: a first "initializer" deposits dust,
    /// then a real liquidity provider deposits a normal amount. Dust-LP
    /// as a fraction of the second deposit's LP must be negligible.
    /// This is the I-M3 exit check from PLAN §3.
    #[test]
    fn first_lp_sandwich_attempt_is_negligible() {
        let dust_lp = calc_lp_tokens_out(1, 1);
        let real_lp = calc_lp_tokens_out(1_000_000_000, 1_000_000_000);
        assert!(
            dust_lp * 10_000 < real_lp,
            "dust_lp={} is not < 1bp of real_lp={}",
            dust_lp,
            real_lp
        );
    }
}
