// Reentrancy protection helpers.
//
// A malicious SY program can CPI back into us during our own CPI. The only
// thing standing between that and corrupted state is the `reentrancy_guard`
// byte on Vault / MarketTwo and a disciplined set → persist → CPI → reload
// dance around every CPI into untrusted code.
//
// Invariants this module enforces:
//   - Entry to any user-facing instruction: `require!(!guard, ReentrancyLocked)`.
//   - Before the CPI: `guard = true; persist(account)?;` so a reentrant call
//     that reads the same account sees the latch set on-chain.
//   - After the CPI: `account.reload()?; guard = false;` (and the end-of-ix
//     serialization handled by Anchor flushes the cleared value back).
//
// The `Reentrant` trait is implemented on Vault and MarketTwo in state/*.rs.

use anchor_lang::prelude::*;

use crate::error::ExponentCoreError;

pub trait Reentrant {
    fn reentrancy_guard(&self) -> bool;
    fn set_reentrancy_guard(&mut self, v: bool);
}

/// Assert the guard is clear and latch it.
pub fn enter<T: Reentrant>(obj: &mut T) -> Result<()> {
    require!(!obj.reentrancy_guard(), ExponentCoreError::ReentrancyLocked);
    obj.set_reentrancy_guard(true);
    Ok(())
}

/// Clear the latch. Paired with `enter`.
pub fn leave<T: Reentrant>(obj: &mut T) {
    obj.set_reentrancy_guard(false);
}

/// Serialize the account back to its data slot. Call this before a CPI into
/// untrusted code so the guard bit is visible on-chain during the CPI.
///
/// Intentionally scoped: the whole struct gets rewritten, not just the guard
/// byte, so any other state changes made before this call also get flushed.
pub fn persist<'info, T>(account: &Account<'info, T>) -> Result<()>
where
    T: anchor_lang::AccountSerialize + anchor_lang::AccountDeserialize + anchor_lang::Owner + Clone,
{
    let info = account.to_account_info();
    let mut data = info.try_borrow_mut_data()?;
    let mut writer: &mut [u8] = &mut data;
    account.try_serialize(&mut writer)?;
    Ok(())
}
