// Mock Kamino Lend V2 program — TEST ONLY.
//
// What this is:
//   A minimal stand-in for the klend program (`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`)
//   providing just enough surface area for `kamino_sy_adapter` integration tests:
//     - a `Reserve` account exposing a `collateral_exchange_rate: Number`
//     - `deposit_reserve_liquidity(amount)`: transfers liquidity into a vault PDA and mints
//       collateral (ctokens) to the depositor. Output amount = amount_liquidity / rate.
//     - `redeem_reserve_collateral(amount_collateral)`: burns ctokens and transfers liquidity
//       back. Output amount = amount_collateral * rate.
//     - `poke_exchange_rate(new_rate)`: test hook to simulate interest accrual.
//
// What this is NOT:
//   - Not a real klend. No interest accrual, no borrow side, no oracles, no liquidation.
//   - Not deployed to mainnet/devnet. This program never leaves the local validator.
//
// The adapter hits the same account shape and discriminator ordering as the real klend for
// `deposit_reserve_liquidity` / `redeem_reserve_collateral`, so swapping to the real program
// is an account-substitution exercise — not a protocol change.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, Burn, Mint, MintTo, TokenAccount, TokenInterface,
    TransferChecked,
};
use precise_number::Number;

declare_id!("AKeo9L8sGnMABrsUs7gJAk8WLye62hSJ7ikZ6yytCGkv");

pub const RESERVE_SEED: &[u8] = b"reserve";
pub const RESERVE_LIQUIDITY_SUPPLY_SEED: &[u8] = b"reserve_liq_supply";
pub const RESERVE_COLLATERAL_MINT_SEED: &[u8] = b"reserve_coll_mint";

#[program]
pub mod mock_klend {
    use super::*;

    /// Initialize a reserve for a given liquidity mint. Creates the ctoken mint and the
    /// liquidity supply vault. Exchange rate starts at 1.0 (1 liquidity = 1 ctoken).
    pub fn initialize_reserve(ctx: Context<InitializeReserve>) -> Result<()> {
        let r = &mut ctx.accounts.reserve;
        r.lending_market = ctx.accounts.lending_market.key();
        r.liquidity_mint = ctx.accounts.liquidity_mint.key();
        r.liquidity_supply = ctx.accounts.liquidity_supply.key();
        r.collateral_mint = ctx.accounts.collateral_mint.key();
        r.collateral_exchange_rate = Number::from_natural_u64(1);
        r.bump = ctx.bumps.reserve;
        Ok(())
    }

    /// Deposit liquidity tokens; receive ctokens.
    ///   amount_collateral = floor(amount_liquidity / exchange_rate)
    pub fn deposit_reserve_liquidity(
        ctx: Context<DepositReserveLiquidity>,
        amount_liquidity: u64,
    ) -> Result<u64> {
        require!(amount_liquidity > 0, MockKlendError::ZeroAmount);
        let rate = ctx.accounts.reserve.collateral_exchange_rate;
        require!(rate > Number::ZERO, MockKlendError::InvalidExchangeRate);

        // user_liquidity → liquidity_supply
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_liquidity.to_account_info(),
                    mint: ctx.accounts.liquidity_mint.to_account_info(),
                    to: ctx.accounts.liquidity_supply.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_liquidity,
            ctx.accounts.liquidity_mint.decimals,
        )?;

        let amount_collateral = (Number::from_natural_u64(amount_liquidity) / rate).floor_u64();

        // mint ctokens → user
        let liquidity_mint_key = ctx.accounts.reserve.liquidity_mint;
        let bump = [ctx.accounts.reserve.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[RESERVE_SEED, liquidity_mint_key.as_ref(), &bump]];
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.user_collateral.to_account_info(),
                    authority: ctx.accounts.reserve.to_account_info(),
                },
                signer_seeds,
            ),
            amount_collateral,
        )?;

        Ok(amount_collateral)
    }

    /// Redeem ctokens; receive liquidity tokens.
    ///   amount_liquidity = floor(amount_collateral * exchange_rate)
    pub fn redeem_reserve_collateral(
        ctx: Context<RedeemReserveCollateral>,
        amount_collateral: u64,
    ) -> Result<u64> {
        require!(amount_collateral > 0, MockKlendError::ZeroAmount);
        let rate = ctx.accounts.reserve.collateral_exchange_rate;
        require!(rate > Number::ZERO, MockKlendError::InvalidExchangeRate);

        // burn ctokens from user
        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    from: ctx.accounts.user_collateral.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_collateral,
        )?;

        let amount_liquidity = (Number::from_natural_u64(amount_collateral) * rate).floor_u64();

        // liquidity_supply → user
        let liquidity_mint_key = ctx.accounts.reserve.liquidity_mint;
        let bump = [ctx.accounts.reserve.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[RESERVE_SEED, liquidity_mint_key.as_ref(), &bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.liquidity_supply.to_account_info(),
                    mint: ctx.accounts.liquidity_mint.to_account_info(),
                    to: ctx.accounts.user_liquidity.to_account_info(),
                    authority: ctx.accounts.reserve.to_account_info(),
                },
                signer_seeds,
            ),
            amount_liquidity,
            ctx.accounts.liquidity_mint.decimals,
        )?;

        Ok(amount_liquidity)
    }

    /// No-op; mirrors the shape of klend's `refresh_reserve`. Real klend refreshes
    /// oracle prices and accrues interest here; the mock has no interest model.
    pub fn refresh_reserve(_ctx: Context<RefreshReserve>) -> Result<()> {
        Ok(())
    }

    /// Test hook: overwrite the collateral exchange rate. Simulates interest accrual.
    pub fn poke_exchange_rate(
        ctx: Context<PokeExchangeRate>,
        new_rate: Number,
    ) -> Result<()> {
        require!(new_rate > Number::ZERO, MockKlendError::InvalidExchangeRate);
        ctx.accounts.reserve.collateral_exchange_rate = new_rate;
        Ok(())
    }
}

// -------------- State --------------

#[account]
pub struct Reserve {
    pub lending_market: Pubkey,
    pub liquidity_mint: Pubkey,
    pub liquidity_supply: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_exchange_rate: Number,
    pub bump: u8,
}

impl Reserve {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 32 + 1;
}

// -------------- Contexts --------------

#[derive(Accounts)]
pub struct InitializeReserve<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: opaque lending market pubkey — mock doesn't use a LendingMarket struct.
    pub lending_market: UncheckedAccount<'info>,

    pub liquidity_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        seeds = [RESERVE_SEED, liquidity_mint.key().as_ref()],
        bump,
        space = Reserve::SIZE,
    )]
    pub reserve: Box<Account<'info, Reserve>>,

    #[account(
        init,
        payer = payer,
        seeds = [RESERVE_LIQUIDITY_SUPPLY_SEED, reserve.key().as_ref()],
        bump,
        token::mint = liquidity_mint,
        token::authority = reserve,
    )]
    pub liquidity_supply: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [RESERVE_COLLATERAL_MINT_SEED, reserve.key().as_ref()],
        bump,
        mint::authority = reserve,
        mint::decimals = liquidity_mint.decimals,
    )]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositReserveLiquidity<'info> {
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [RESERVE_SEED, reserve.liquidity_mint.as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Box<Account<'info, Reserve>>,

    #[account(address = reserve.liquidity_mint)]
    pub liquidity_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = reserve.liquidity_supply)]
    pub liquidity_supply: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = reserve.collateral_mint)]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = liquidity_mint, token::authority = user)]
    pub user_liquidity: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = collateral_mint)]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RedeemReserveCollateral<'info> {
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [RESERVE_SEED, reserve.liquidity_mint.as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Box<Account<'info, Reserve>>,

    #[account(address = reserve.liquidity_mint)]
    pub liquidity_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = reserve.liquidity_supply)]
    pub liquidity_supply: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = reserve.collateral_mint)]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = liquidity_mint)]
    pub user_liquidity: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = collateral_mint, token::authority = user)]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RefreshReserve<'info> {
    pub reserve: Box<Account<'info, Reserve>>,
}

#[derive(Accounts)]
pub struct PokeExchangeRate<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [RESERVE_SEED, reserve.liquidity_mint.as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Box<Account<'info, Reserve>>,
}

#[error_code]
pub enum MockKlendError {
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Exchange rate must be > 0")]
    InvalidExchangeRate,
}
