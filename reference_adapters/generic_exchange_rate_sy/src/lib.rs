// Reference SY adapter — MVP of the Standardized Yield interface that
// clearstone_core expects from any SY program.
//
// What this is:
//   A minimal, fully-permissionless SY wrapper around one SPL mint. The
//   exchange rate is stored on-chain and pokable by whoever the creator
//   names as `authority` — a stand-in for a real oracle. Anyone can
//   instantiate a new SY market for any mint.
//
// What this is NOT:
//   - Not a production SY. No oracle integration, no emissions, no slashing
//     protection, no supply cap. Just the interface shape.
//   - Not tested at runtime yet. Exit criterion for M5 is "it compiles and
//     the interface matches what the core calls" — end-to-end strip/merge
//     against this adapter lands with the M6 integration suite.
//
// The 10 discriminators map exactly to what `clearstone_core/src/utils/sy_cpi.rs`
// invokes (plus [0] for creator init and [9] for rate-poke, which are
// adapter-only ops):
//   [0] initialize            — create a new SY market
//   [1] mint_sy               — base in, SY out
//   [2] redeem_sy             — SY in, base out
//   [3] init_personal_account — one position per (sy_market, owner)
//   [5] deposit_sy            — transfer SY from owner to adapter, bump position
//   [6] withdraw_sy           — reverse
//   [7] get_sy_state          — read-only, returns (exchange_rate, [])
//   [8] claim_emission        — no-op (this adapter has no emissions)
//   [9] poke_exchange_rate    — authority-gated manual rate update
//   [10] get_position         — read-only, returns PositionState

#![allow(unexpected_cfgs)]

use amount_value::Amount;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, Burn, Mint, MintTo, TokenAccount, TokenInterface,
    TransferChecked,
};
use precise_number::Number;
use sy_common::{MintSyReturnData, PositionState, RedeemSyReturnData, SyState};

declare_id!("DZEqpkctMmB1Xq6foy1KnP3VayVFgJfykzi49fpWZ8M6");

pub const SY_MARKET_SEED: &[u8] = b"sy_market";
pub const SY_MINT_SEED: &[u8] = b"sy_mint";
pub const POOL_ESCROW_SEED: &[u8] = b"pool_escrow";
pub const PERSONAL_POSITION_SEED: &[u8] = b"personal_position";

#[program]
pub mod generic_exchange_rate_sy {
    use super::*;

    /// Create a new SY market wrapping `base_mint`. Anyone can call this
    /// once per base_mint — the SyMarket PDA is derived from the mint.
    #[instruction(discriminator = [0])]
    pub fn initialize(
        ctx: Context<Initialize>,
        initial_exchange_rate: Number,
    ) -> Result<()> {
        let m = &mut ctx.accounts.sy_market;
        m.authority = ctx.accounts.authority.key();
        m.base_mint = ctx.accounts.base_mint.key();
        m.sy_mint = ctx.accounts.sy_mint.key();
        m.pool_escrow = ctx.accounts.pool_escrow.key();
        m.exchange_rate = initial_exchange_rate;
        m.sy_market_bump = ctx.bumps.sy_market;
        Ok(())
    }

    /// Mint SY from base. `sy_out = floor(base_in / exchange_rate)`.
    #[instruction(discriminator = [1])]
    pub fn mint_sy(
        ctx: Context<MintSy>,
        amount_base: u64,
    ) -> Result<MintSyReturnData> {
        let rate = ctx.accounts.sy_market.exchange_rate;
        require!(rate > Number::ZERO, AdapterError::InvalidExchangeRate);

        // pull base from user
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.base_src.to_account_info(),
                mint: ctx.accounts.base_mint.to_account_info(),
                to: ctx.accounts.base_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        transfer_checked(cpi_ctx, amount_base, ctx.accounts.base_mint.decimals)?;

        // sy_out = floor(amount_base / exchange_rate)
        let sy_out = (Number::from_natural_u64(amount_base) / rate).floor_u64();

        // mint SY to user
        let market_key = ctx.accounts.sy_market.key();
        let bump = [ctx.accounts.sy_market.sy_market_bump];
        let base_mint_key = ctx.accounts.base_mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[SY_MARKET_SEED, base_mint_key.as_ref(), &bump]];
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.sy_mint.to_account_info(),
                    to: ctx.accounts.sy_dst.to_account_info(),
                    authority: ctx.accounts.sy_market.to_account_info(),
                },
                signer_seeds,
            ),
            sy_out,
        )?;
        let _ = market_key; // silence unused warning from signer_seeds borrow

        Ok(MintSyReturnData {
            sy_out_amount: sy_out,
            exchange_rate: rate,
        })
    }

    /// Burn SY, return base. `base_out = floor(amount_sy * exchange_rate)`.
    #[instruction(discriminator = [2])]
    pub fn redeem_sy(
        ctx: Context<RedeemSy>,
        amount_sy: u64,
    ) -> Result<RedeemSyReturnData> {
        let rate = ctx.accounts.sy_market.exchange_rate;
        require!(rate > Number::ZERO, AdapterError::InvalidExchangeRate);

        // burn SY from user
        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.sy_mint.to_account_info(),
                    from: ctx.accounts.sy_src.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount_sy,
        )?;

        let base_out = (Number::from_natural_u64(amount_sy) * rate).floor_u64();

        // transfer base out of vault to user
        let base_mint_key = ctx.accounts.base_mint.key();
        let bump = [ctx.accounts.sy_market.sy_market_bump];
        let signer_seeds: &[&[&[u8]]] = &[&[SY_MARKET_SEED, base_mint_key.as_ref(), &bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.base_vault.to_account_info(),
                    mint: ctx.accounts.base_mint.to_account_info(),
                    to: ctx.accounts.base_dst.to_account_info(),
                    authority: ctx.accounts.sy_market.to_account_info(),
                },
                signer_seeds,
            ),
            base_out,
            ctx.accounts.base_mint.decimals,
        )?;

        Ok(RedeemSyReturnData {
            base_out_amount: base_out,
            exchange_rate: rate,
        })
    }

    /// Create a PersonalPosition for `owner` on this SY market.
    /// Positions are PDAs keyed by (sy_market, owner).
    #[instruction(discriminator = [3])]
    pub fn init_personal_account(ctx: Context<InitPersonalAccount>) -> Result<()> {
        let pos = &mut ctx.accounts.position;
        pos.sy_market = ctx.accounts.sy_market.key();
        pos.owner = ctx.accounts.owner.key();
        pos.sy_balance = 0;
        Ok(())
    }

    /// Deposit SY into the adapter's pool escrow and credit the position.
    /// Returns the current SyState so the caller can update its view.
    #[instruction(discriminator = [5])]
    pub fn deposit_sy(ctx: Context<DepositSy>, amount: u64) -> Result<SyState> {
        if amount > 0 {
            transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.sy_src.to_account_info(),
                        mint: ctx.accounts.sy_mint.to_account_info(),
                        to: ctx.accounts.pool_escrow.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                amount,
                ctx.accounts.sy_mint.decimals,
            )?;
            let pos = &mut ctx.accounts.position;
            pos.sy_balance = pos
                .sy_balance
                .checked_add(amount)
                .ok_or(AdapterError::Overflow)?;
        }

        Ok(SyState {
            exchange_rate: ctx.accounts.sy_market.exchange_rate,
            emission_indexes: vec![],
        })
    }

    /// Withdraw SY from pool escrow back to the owner.
    #[instruction(discriminator = [6])]
    pub fn withdraw_sy(ctx: Context<WithdrawSy>, amount: u64) -> Result<SyState> {
        if amount > 0 {
            {
                let pos = &mut ctx.accounts.position;
                pos.sy_balance = pos
                    .sy_balance
                    .checked_sub(amount)
                    .ok_or(AdapterError::InsufficientBalance)?;
            }

            let base_mint_key = ctx.accounts.sy_market.base_mint;
            let bump = [ctx.accounts.sy_market.sy_market_bump];
            let signer_seeds: &[&[&[u8]]] = &[&[SY_MARKET_SEED, base_mint_key.as_ref(), &bump]];
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.pool_escrow.to_account_info(),
                        mint: ctx.accounts.sy_mint.to_account_info(),
                        to: ctx.accounts.sy_dst.to_account_info(),
                        authority: ctx.accounts.sy_market.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
                ctx.accounts.sy_mint.decimals,
            )?;
        }

        Ok(SyState {
            exchange_rate: ctx.accounts.sy_market.exchange_rate,
            emission_indexes: vec![],
        })
    }

    /// Read-only: current SyState.
    #[instruction(discriminator = [7])]
    pub fn get_sy_state(ctx: Context<GetSyState>) -> Result<SyState> {
        Ok(SyState {
            exchange_rate: ctx.accounts.sy_market.exchange_rate,
            emission_indexes: vec![],
        })
    }

    /// No-op: this reference adapter has no emissions.
    /// The `amount` arg is accepted to match the core's call shape.
    #[instruction(discriminator = [8])]
    pub fn claim_emission(_ctx: Context<ClaimEmission>, _amount: Amount) -> Result<()> {
        Ok(())
    }

    /// Authority-only: overwrite the stored exchange rate.
    /// Stand-in for a real oracle read.
    #[instruction(discriminator = [9])]
    pub fn poke_exchange_rate(
        ctx: Context<PokeExchangeRate>,
        new_rate: Number,
    ) -> Result<()> {
        require!(new_rate > Number::ZERO, AdapterError::InvalidExchangeRate);
        ctx.accounts.sy_market.exchange_rate = new_rate;
        Ok(())
    }

    /// Read-only: position data for the passed PersonalPosition.
    #[instruction(discriminator = [10])]
    pub fn get_position(ctx: Context<GetPosition>) -> Result<PositionState> {
        let p = &ctx.accounts.position;
        Ok(PositionState {
            owner: p.owner,
            sy_balance: p.sy_balance,
            emissions: vec![],
        })
    }
}

// -------------- State --------------

#[account]
pub struct SyMarket {
    /// Who can poke the exchange rate. No admin hierarchy — creator is it.
    pub authority: Pubkey,
    pub base_mint: Pubkey,
    pub sy_mint: Pubkey,
    pub pool_escrow: Pubkey,
    /// Base units per 1 SY. Monotonicity is NOT enforced in this reference;
    /// a production adapter should guarantee it (ATH monotonicity — I-V3).
    pub exchange_rate: Number,
    pub sy_market_bump: u8,
}

impl SyMarket {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 32 + 1; // discriminator + fields
}

#[account]
pub struct PersonalPosition {
    pub sy_market: Pubkey,
    pub owner: Pubkey,
    pub sy_balance: u64,
}

impl PersonalPosition {
    pub const SIZE: usize = 8 + 32 + 32 + 8;
}

// -------------- Account contexts --------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Authority that can later poke the exchange rate. Does NOT have to
    /// equal the payer — creators can hand this to a timelock or oracle.
    /// CHECK: stored on the SyMarket; never used as a signer here.
    pub authority: UncheckedAccount<'info>,

    pub base_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        seeds = [SY_MARKET_SEED, base_mint.key().as_ref()],
        bump,
        space = SyMarket::SIZE,
    )]
    pub sy_market: Box<Account<'info, SyMarket>>,

    /// SY mint; authority is the sy_market PDA.
    #[account(
        init,
        payer = payer,
        seeds = [SY_MINT_SEED, sy_market.key().as_ref()],
        bump,
        mint::authority = sy_market,
        mint::decimals = base_mint.decimals,
    )]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Pool escrow for base asset (pays out on redeem).
    #[account(
        init,
        payer = payer,
        seeds = [POOL_ESCROW_SEED, sy_market.key().as_ref(), base_mint.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = sy_market,
    )]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Pool escrow for deposited SY (deposit_sy / withdraw_sy flow).
    #[account(
        init,
        payer = payer,
        seeds = [POOL_ESCROW_SEED, sy_market.key().as_ref(), sy_mint.key().as_ref()],
        bump,
        token::mint = sy_mint,
        token::authority = sy_market,
    )]
    pub pool_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintSy<'info> {
    pub owner: Signer<'info>,

    #[account(seeds = [SY_MARKET_SEED, base_mint.key().as_ref()], bump = sy_market.sy_market_bump)]
    pub sy_market: Box<Account<'info, SyMarket>>,

    #[account(address = sy_market.base_mint)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = sy_market.sy_mint)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = base_mint, token::authority = owner)]
    pub base_src: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = sy_mint)]
    pub sy_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RedeemSy<'info> {
    pub owner: Signer<'info>,

    #[account(seeds = [SY_MARKET_SEED, base_mint.key().as_ref()], bump = sy_market.sy_market_bump)]
    pub sy_market: Box<Account<'info, SyMarket>>,

    #[account(address = sy_market.base_mint)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = sy_market.sy_mint)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = sy_mint, token::authority = owner)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = base_mint)]
    pub base_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct InitPersonalAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The owner the position is being created for. Does not need to be the
    /// payer — a router program can init positions on behalf of callers.
    /// CHECK: only stored, never used as a signer here.
    pub owner: UncheckedAccount<'info>,

    pub sy_market: Box<Account<'info, SyMarket>>,

    #[account(
        init,
        payer = payer,
        seeds = [PERSONAL_POSITION_SEED, sy_market.key().as_ref(), owner.key().as_ref()],
        bump,
        space = PersonalPosition::SIZE,
    )]
    pub position: Box<Account<'info, PersonalPosition>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositSy<'info> {
    /// Must sign. Moves SY from sy_src to the adapter's pool.
    pub owner: Signer<'info>,

    pub sy_market: Box<Account<'info, SyMarket>>,

    #[account(mut, address = sy_market.sy_mint)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = sy_mint, token::authority = owner)]
    pub sy_src: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = sy_market.pool_escrow)]
    pub pool_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [PERSONAL_POSITION_SEED, sy_market.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = sy_market,
        has_one = owner,
    )]
    pub position: Box<Account<'info, PersonalPosition>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawSy<'info> {
    pub owner: Signer<'info>,

    pub sy_market: Box<Account<'info, SyMarket>>,

    #[account(mut, address = sy_market.sy_mint)]
    pub sy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = sy_mint)]
    pub sy_dst: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = sy_market.pool_escrow)]
    pub pool_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [PERSONAL_POSITION_SEED, sy_market.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = sy_market,
        has_one = owner,
    )]
    pub position: Box<Account<'info, PersonalPosition>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct GetSyState<'info> {
    pub sy_market: Box<Account<'info, SyMarket>>,
}

#[derive(Accounts)]
pub struct ClaimEmission<'info> {
    pub sy_market: Box<Account<'info, SyMarket>>,
}

#[derive(Accounts)]
pub struct PokeExchangeRate<'info> {
    pub authority: Signer<'info>,

    #[account(mut, has_one = authority)]
    pub sy_market: Box<Account<'info, SyMarket>>,
}

#[derive(Accounts)]
pub struct GetPosition<'info> {
    pub sy_market: Box<Account<'info, SyMarket>>,

    #[account(has_one = sy_market)]
    pub position: Box<Account<'info, PersonalPosition>>,
}

// -------------- Errors --------------

#[error_code]
pub enum AdapterError {
    #[msg("Invalid exchange rate (must be > 0)")]
    InvalidExchangeRate,
    #[msg("Position balance overflow")]
    Overflow,
    #[msg("Position balance underflow")]
    InsufficientBalance,
}
