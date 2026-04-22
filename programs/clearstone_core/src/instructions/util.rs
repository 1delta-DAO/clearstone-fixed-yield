use anchor_lang::{prelude::*, solana_program::address_lookup_table::state::AddressLookupTable};
use anchor_spl::token_2022::{self, Transfer};
use anchor_spl::token_interface::{self, TransferChecked};

pub fn deserialize_lookup_table(account: &AccountInfo) -> Vec<Pubkey> {
    AddressLookupTable::deserialize(&account.data.borrow())
        .unwrap()
        .addresses
        .to_vec()
}

/// Plain transfer wrapper — still used for PT/YT/emission token movements
/// where the mints are core-owned SPL mints and `transfer_checked` adds no safety.
/// SY transfers MUST go through `sy_transfer_checked` (I-KYC1).
pub fn token_transfer<'i>(
    ctx: CpiContext<'_, '_, '_, 'i, Transfer<'i>>,
    amount: u64,
) -> Result<()> {
    #[allow(deprecated)]
    token_2022::transfer(ctx, amount)
}

/// Checked transfer for SY. Required whenever the SY mint may carry Token-2022
/// extensions (ConfidentialTransfer, TransferHook, etc). Passes the mint + decimals
/// through so the T2022 program enforces extension-specific checks on every move.
///
/// The `decimals` argument is read from the mint's `InterfaceAccount<Mint>` on the
/// calling instruction's Accounts struct — the mint is constrained via
/// `has_one = mint_sy` on the vault/market, so it can't be swapped.
pub fn sy_transfer_checked<'i>(
    ctx: CpiContext<'_, '_, '_, 'i, TransferChecked<'i>>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    token_interface::transfer_checked(ctx, amount, decimals)
}

pub fn now() -> u32 {
    Clock::get().unwrap().unix_timestamp as u32
}
