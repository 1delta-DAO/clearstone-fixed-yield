use anchor_lang::prelude::*;

use crate::{cpi_common::CpiAccounts, error::ExponentCoreError, LiquidityNetBalanceLimits, MarketTwo};

/// Curator-gated actions on a live market. Same rules as AdminAction: only
/// pauses, ratchet-downs, and bookkeeping. The core curve parameters
/// (`ln_fee_rate_root`, `rate_scalar_root`) and `max_lp_supply` are frozen at
/// init and cannot be changed — a curator who wants a different curve must
/// spin up a new market.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum MarketAdminAction {
    SetStatus(u8),
    /// Lower `fee_treasury_sy_bps`. Must be <= current value.
    LowerTreasuryTradeSyBpsFee(u16),
    ChangeCpiAccounts {
        cpi_accounts: CpiAccounts,
    },
    ChangeLiquidityNetBalanceLimits {
        max_net_balance_change_negative_percentage: u16,
        max_net_balance_change_positive_percentage: u32,
        window_duration_seconds: u32,
    },
    ChangeAddressLookupTable(Pubkey),
    RemoveMarketEmission(u8),
}

#[derive(Accounts)]
pub struct ModifyMarketSetting<'info> {
    #[account(
        mut,
        has_one = curator,
    )]
    pub market: Account<'info, MarketTwo>,

    #[account(mut)]
    pub curator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ModifyMarketSetting>, action: MarketAdminAction) -> Result<()> {
    let market = &mut ctx.accounts.market;

    match action {
        MarketAdminAction::SetStatus(new_status) => {
            market.status_flags = new_status;
        }
        MarketAdminAction::LowerTreasuryTradeSyBpsFee(new_fee) => {
            require!(
                new_fee <= market.fee_treasury_sy_bps,
                ExponentCoreError::FeeNotRatchetDown
            );
            market.fee_treasury_sy_bps = new_fee;
        }
        MarketAdminAction::ChangeCpiAccounts { cpi_accounts } => {
            let old_size = market.to_account_info().data_len();
            let new_size = MarketTwo::size_of(
                &cpi_accounts,
                market.emissions.trackers.len(),
                market.lp_farm.farm_emissions.len(),
            );

            if new_size > old_size {
                let additional_rent = Rent::get()?.minimum_balance(new_size - old_size);
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: ctx.accounts.curator.to_account_info(),
                            to: market.to_account_info(),
                        },
                    ),
                    additional_rent,
                )?;
            }

            market.to_account_info().realloc(new_size, false)?;
            market.cpi_accounts = cpi_accounts;
        }
        MarketAdminAction::ChangeLiquidityNetBalanceLimits {
            max_net_balance_change_negative_percentage,
            max_net_balance_change_positive_percentage,
            window_duration_seconds,
        } => {
            market.liquidity_net_balance_limits = LiquidityNetBalanceLimits {
                max_net_balance_change_negative_percentage,
                max_net_balance_change_positive_percentage,
                window_duration_seconds,
                window_start_timestamp: Clock::get()?.unix_timestamp as u32,
                window_start_net_balance: market
                    .liquidity_net_balance_limits
                    .window_start_net_balance,
            };
        }
        MarketAdminAction::ChangeAddressLookupTable(address_lookup_table) => {
            market.address_lookup_table = address_lookup_table;
        }
        MarketAdminAction::RemoveMarketEmission(emission_index) => {
            market.emissions.trackers.remove(emission_index as usize);
        }
    }
    Ok(())
}
