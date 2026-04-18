use anchor_lang::prelude::*;

use crate::{cpi_common::CpiAccounts, error::ExponentCoreError, Vault};

/// Curator-gated actions on a live vault. Every variant here is either a
/// *pause* (status flags), a *ratchet-down* (interest fee), or a *bookkeeping*
/// update (treasury target, claim limits). No variant can raise a fee, change
/// the curve, relax safety limits, or bump `max_py_supply` — those are
/// immutable post-init (PLAN §6.2 / I-E2).
#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum AdminAction {
    SetVaultStatus(u8),
    /// Lower `interest_bps_fee`. Must be strictly <= the current value.
    LowerInterestBpsFee(u16),
    ChangeVaultTreasuryTokenAccount(Pubkey),
    ChangeEmissionTreasuryTokenAccount {
        emission_index: u16,
        new_token_account: Pubkey,
    },
    ChangeMinOperationSize {
        is_strip: bool,
        new_size: u64,
    },
    /// Lower an emission's fee_bps. Must be <= current.
    LowerEmissionBpsFee {
        emission_index: u16,
        new_fee_bps: u16,
    },
    ChangeCpiAccounts {
        cpi_accounts: CpiAccounts,
    },
    ChangeClaimLimits {
        max_claim_amount_per_window: u64,
        claim_window_duration_seconds: u32,
    },
    ChangeAddressLookupTable(Pubkey),
    RemoveVaultEmission(u8),
}

#[derive(Accounts)]
pub struct ModifyVaultSetting<'info> {
    #[account(
        mut,
        has_one = curator,
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub curator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ModifyVaultSetting>, action: AdminAction) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    match action {
        AdminAction::SetVaultStatus(new_status) => {
            vault.status = new_status;
        }
        AdminAction::LowerInterestBpsFee(new_fee) => {
            require!(
                new_fee <= vault.interest_bps_fee,
                ExponentCoreError::FeeNotRatchetDown
            );
            vault.interest_bps_fee = new_fee;
        }
        AdminAction::ChangeVaultTreasuryTokenAccount(new_account) => {
            vault.treasury_sy_token_account = new_account;
        }
        AdminAction::ChangeEmissionTreasuryTokenAccount {
            emission_index,
            new_token_account,
        } => {
            vault.emissions[emission_index as usize].treasury_token_account = new_token_account;
        }
        AdminAction::ChangeMinOperationSize { is_strip, new_size } => {
            require!(new_size > 0, ExponentCoreError::MinOperationSizeZero);
            if is_strip {
                vault.min_op_size_strip = new_size;
            } else {
                vault.min_op_size_merge = new_size;
            }
        }
        AdminAction::LowerEmissionBpsFee {
            emission_index,
            new_fee_bps,
        } => {
            let current = vault.emissions[emission_index as usize].fee_bps;
            require!(
                new_fee_bps <= current,
                ExponentCoreError::FeeNotRatchetDown
            );
            vault.emissions[emission_index as usize].fee_bps = new_fee_bps;
        }
        AdminAction::ChangeCpiAccounts { cpi_accounts } => {
            let old_size = vault.to_account_info().data_len();
            let new_size = Vault::size_of_static(vault.emissions.len()) + cpi_accounts.size_of();

            if new_size > old_size {
                let additional_rent = Rent::get()?.minimum_balance(new_size - old_size);
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: ctx.accounts.curator.to_account_info(),
                            to: vault.to_account_info(),
                        },
                    ),
                    additional_rent,
                )?;
            }

            vault.to_account_info().realloc(new_size, false)?;
            vault.cpi_accounts = cpi_accounts;
        }
        AdminAction::ChangeClaimLimits {
            max_claim_amount_per_window,
            claim_window_duration_seconds,
        } => {
            vault.claim_limits.claim_window_start_timestamp = Clock::get()?.unix_timestamp as u32;
            vault.claim_limits.total_claim_amount_in_window = 0;
            vault.claim_limits.max_claim_amount_per_window = max_claim_amount_per_window;
            vault.claim_limits.claim_window_duration_seconds = claim_window_duration_seconds;
        }
        AdminAction::ChangeAddressLookupTable(address_lookup_table) => {
            vault.address_lookup_table = address_lookup_table;
        }
        AdminAction::RemoveVaultEmission(emission_index) => {
            vault.emissions.remove(emission_index as usize);
        }
    }

    Ok(())
}
