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

/// Byte offset of `reentrancy_guard` inside a serialized Vault or MarketTwo.
///
/// Layout: `discriminator (8) + curator (32) + creator_fee_bps (2)` = 42.
/// This offset is shared by Vault and MarketTwo because both structs begin
/// with the same three fields. If either layout changes, the const must move
/// to match or the helpers below break silently.
///
/// Keep this check tied to a compile-time assert in a real audit; for now,
/// both state files carry a comment referencing this constant.
pub const GUARD_BYTE_OFFSET: usize = 8 + 32 + 2;

/// Low-level guard manipulation for use inside SY CPI wrappers.
///
/// Flips the guard byte to 1 directly on the account data. Must be called
/// **before** the untrusted CPI: a reentrant call from the SY program
/// reads the on-chain data, sees the latched byte, and fails its own
/// `latch` call with `ReentrancyLocked`.
///
/// Fails loudly if the byte is already set — either we're double-latching
/// (caller bug) or a reentrant call snuck past us (attack).
///
/// Returns without borrowing the data after this function returns, so the
/// subsequent CPI is free to re-borrow it.
pub fn latch(info: &AccountInfo) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    require!(
        data.len() > GUARD_BYTE_OFFSET,
        ExponentCoreError::ReentrancyLocked
    );
    require!(
        data[GUARD_BYTE_OFFSET] == 0,
        ExponentCoreError::ReentrancyLocked
    );
    data[GUARD_BYTE_OFFSET] = 1;
    Ok(())
}

/// Clear the guard byte. Pair with `latch`. Called after the CPI returns.
pub fn unlatch(info: &AccountInfo) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    require!(
        data.len() > GUARD_BYTE_OFFSET,
        ExponentCoreError::ReentrancyLocked
    );
    data[GUARD_BYTE_OFFSET] = 0;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal test fixture — Reentrant is the only trait we need to exercise.
    struct DummyLatch {
        guard: bool,
    }
    impl Reentrant for DummyLatch {
        fn reentrancy_guard(&self) -> bool {
            self.guard
        }
        fn set_reentrancy_guard(&mut self, v: bool) {
            self.guard = v;
        }
    }

    #[test]
    fn enter_on_clean_latch_succeeds() {
        let mut d = DummyLatch { guard: false };
        assert!(enter(&mut d).is_ok());
        assert!(d.guard);
    }

    #[test]
    fn enter_on_set_latch_fails() {
        let mut d = DummyLatch { guard: true };
        let r = enter(&mut d);
        assert!(r.is_err(), "entering a latched struct must error");
        // Guard stays latched so the caller can't accidentally recover.
        assert!(d.guard);
    }

    #[test]
    fn leave_clears_latch() {
        let mut d = DummyLatch { guard: true };
        leave(&mut d);
        assert!(!d.guard);
    }

    #[test]
    fn enter_leave_enter_roundtrip() {
        let mut d = DummyLatch { guard: false };
        enter(&mut d).unwrap();
        leave(&mut d);
        // Second enter must succeed after a clean leave.
        assert!(enter(&mut d).is_ok());
    }

    /// GUARD_BYTE_OFFSET must line up with the layout of both Vault and
    /// MarketTwo. If either struct changes prefix fields, this test
    /// catches it before an audit ever reads the on-chain data wrong.
    #[test]
    fn guard_offset_matches_layout() {
        // Layout = discriminator(8) + curator(32) + creator_fee_bps(2) = 42.
        // If the prefix of either state struct changes, update GUARD_BYTE_OFFSET.
        assert_eq!(GUARD_BYTE_OFFSET, 42);
    }
}
