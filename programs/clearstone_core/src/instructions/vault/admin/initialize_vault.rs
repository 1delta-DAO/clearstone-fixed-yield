use crate::{
    constants::{MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, PROTOCOL_FEE_MAX_BPS},
    error::ExponentCoreError,
    seeds::{AUTHORITY_SEED, ESCROW_YT_SEED, MINT_PT_SEED, MINT_YT_SEED, YIELD_POSITION_SEED},
    state::cpi_common::CpiAccounts,
};
use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::Token, token_interface::*};

use mpl_token_metadata::{
    instructions::{CreateMetadataAccountV3Cpi, CreateMetadataAccountV3CpiAccounts},
    types::DataV2,
};
use token_util::{create_associated_token_account_2022, create_token_account};

use crate::{state::*, utils::cpi_init_sy_personal_account};

#[derive(Accounts)]
#[instruction(
    start_timestamp: u32,
    duration: u32,
    interest_bps_fee: u16,
    cpi_accounts: CpiAccounts,
    min_op_size_strip: u64,
    min_op_size_merge: u64,
    pt_metadata_name: String,
    pt_metadata_symbol: String,
    pt_metadata_uri: String,
    curator: Pubkey,
    creator_fee_bps: u16,
    max_py_supply: u64,
    emissions_seed: Vec<EmissionSeed>,
    enable_metadata: bool,
)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The signer for the vault
    #[account(
        seeds = [
            AUTHORITY_SEED,
            vault.key().as_ref(),
        ],
        bump,
    )]
    pub authority: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        // The space for the vault is the sum of the static space and the space of the CPI accounts
        space = Vault::size_of_static(emissions_seed.len()) + cpi_accounts.size_of(),
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init,
        payer = payer,
        seeds = [
            MINT_PT_SEED,
            vault.key().as_ref(),
        ],
        bump,
        mint::authority = authority,
        mint::decimals = mint_sy.decimals,
        // extensions::metadata_pointer::authority = payer,
    )]
    pub mint_pt: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        seeds = [
            MINT_YT_SEED,
            vault.key().as_ref(),
        ],
        bump,
        mint::authority = authority,
        mint::decimals = mint_sy.decimals,
    )]
    pub mint_yt: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: token account created in instruction handler
    #[account(
        mut,
        seeds = [
            ESCROW_YT_SEED,
            vault.key().as_ref(),
        ],
        bump
    )]
    pub escrow_yt: UncheckedAccount<'info>,

    /// CHECK: token account created as ATA for vault authority in instruction handler
    #[account(mut)]
    pub escrow_sy: UncheckedAccount<'info>,

    pub mint_sy: Box<InterfaceAccount<'info, Mint>>,

    pub system_program: Program<'info, System>,

    pub token_program: Program<'info, Token>,

    #[account(
        token::mint = mint_sy,
    )]
    pub treasury_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    /// CHECK: This is a high-trust function, and the sy_program is not verified
    pub sy_program: UncheckedAccount<'info>,

    /// CHECK:
    pub address_lookup_table: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = YieldTokenPosition::size_of(0),
        seeds = [
            YIELD_POSITION_SEED,
            vault.key().as_ref(),
            authority.key().as_ref(),
        ],
        bump
    )
    ]
    pub yield_position: Box<Account<'info, YieldTokenPosition>>,

    /// CHECK:   
    #[account(
        mut,
        seeds = [
            b"metadata",
            mpl_token_metadata::ID.as_ref(),
            mint_pt.key().as_ref()
        ],
        seeds::program = mpl_token_metadata::ID,
        bump
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK:
    #[account(
        address = mpl_token_metadata::ID
    )]
    pub token_metadata_program: UncheckedAccount<'info>,
}

impl InitializeVault<'_> {
    fn set_vault(
        &mut self,
        start_timestamp: u32,
        duration: u32,
        cpi_accounts: CpiAccounts,
        address_lookup_table: Pubkey,
        vault_signer_bump: u8,
        interest_bps_fee: u16,
        min_op_size_strip: u64,
        min_op_size_merge: u64,
        curator: Pubkey,
        creator_fee_bps: u16,
        max_py_supply: u64,
    ) {
        let address = self.vault.key();
        let vault = &mut self.vault;

        vault.curator = curator;
        vault.creator_fee_bps = creator_fee_bps;
        vault.reentrancy_guard = false;

        msg!("sy program is {:?}", self.sy_program.key());
        vault.sy_program = self.sy_program.key();

        vault.start_ts = start_timestamp;
        vault.duration = duration;

        // Set up vault-specific signer
        vault.signer_seed = address;
        vault.signer_bump = [vault_signer_bump];
        vault.authority = self.authority.key();

        vault.mint_sy = self.mint_sy.key();
        vault.mint_pt = self.mint_pt.key();
        vault.mint_yt = self.mint_yt.key();

        vault.escrow_yt = self.escrow_yt.key();
        vault.escrow_sy = self.escrow_sy.key();

        vault.yield_position = self.yield_position.key();
        vault.address_lookup_table = address_lookup_table;

        vault.treasury_sy_token_account = self.treasury_token_account.key();
        vault.interest_bps_fee = interest_bps_fee;

        vault.min_op_size_strip = min_op_size_strip;
        vault.min_op_size_merge = min_op_size_merge;

        vault.status = STATUS_CAN_STRIP
            | STATUS_CAN_MERGE
            | STATUS_CAN_DEPOSIT_YT
            | STATUS_CAN_WITHDRAW_YT
            | STATUS_CAN_COLLECT_INTEREST
            | STATUS_CAN_COLLECT_EMISSIONS;

        vault.cpi_accounts = cpi_accounts;

        vault.claim_limits = ClaimLimits {
            claim_window_start_timestamp: start_timestamp,
            total_claim_amount_in_window: 0,
            max_claim_amount_per_window: u64::MAX,
            claim_window_duration_seconds: duration,
        };

        vault.max_py_supply = max_py_supply;
    }

    fn set_yield_position(&mut self) {
        self.yield_position.owner = self.authority.key();
        self.yield_position.vault = self.vault.key();
    }

    /// Create metadata for the PT mint. Uses MPL's lower-level
    /// `CreateMetadataAccountV3::instruction()` to build the ix, then
    /// drives it through our own `invoke_signed` so we control the
    /// AccountInfo list explicitly — the high-level CpiBuilder proved
    /// fragile under Anchor 0.31.
    fn create_metadata(&self, name: String, symbol: String, uri: String) -> Result<()> {
        use anchor_lang::solana_program::program::invoke_signed;

        let metadata = self.metadata.to_account_info();
        let mint = self.mint_pt.to_account_info();
        let mint_authority = self.authority.to_account_info();
        let payer = self.payer.to_account_info();
        let system_program = self.system_program.to_account_info();
        let token_metadata_program = self.token_metadata_program.to_account_info();

        let ix = mpl_token_metadata::instructions::CreateMetadataAccountV3 {
            metadata: metadata.key(),
            mint: mint.key(),
            mint_authority: mint_authority.key(),
            payer: payer.key(),
            update_authority: (payer.key(), true),
            system_program: system_program.key(),
            rent: None,
        }
        .instruction(
            mpl_token_metadata::instructions::CreateMetadataAccountV3InstructionArgs {
                data: DataV2 {
                    uri,
                    name,
                    symbol,
                    seller_fee_basis_points: 0,
                    collection: None,
                    creators: None,
                    uses: None,
                },
                is_mutable: true,
                collection_details: None,
            },
        );

        invoke_signed(
            &ix,
            &[
                metadata,
                mint,
                mint_authority,
                payer,
                system_program,
                token_metadata_program,
            ],
            &[&self.vault.signer_seeds()],
        )?;

        Ok(())
    }
}

pub fn handler(
    ctx: Context<InitializeVault>,
    start_timestamp: u32,
    duration: u32,
    interest_bps_fee: u16,
    cpi_accounts: CpiAccounts,
    min_op_size_strip: u64,
    min_op_size_merge: u64,
    pt_metadata_name: String,
    pt_metadata_symbol: String,
    pt_metadata_uri: String,
    curator: Pubkey,
    creator_fee_bps: u16,
    max_py_supply: u64,
    emissions_seed: Vec<EmissionSeed>,
    enable_metadata: bool,
) -> Result<()> {
    // PLAN §6.2 init validations — these are the immutable safety rails.
    require!(
        creator_fee_bps <= PROTOCOL_FEE_MAX_BPS,
        ExponentCoreError::FeeExceedsProtocolCap
    );
    require!(
        interest_bps_fee <= creator_fee_bps,
        ExponentCoreError::FeeExceedsProtocolCap
    );
    require!(
        duration >= MIN_DURATION_SECONDS && duration <= MAX_DURATION_SECONDS,
        ExponentCoreError::DurationOutOfBounds
    );
    // Allow a small grace window (2 minutes) on the "start in the
    // future" check. Callers typically read the clock on the client
    // then build+send a tx; the validator clock moves between those
    // two points. Treating any start_ts within 2 minutes of `now` as
    // acceptable rules out any retroactive-accrual exploit (the check
    // is an economic guard, not a precise one).
    const START_TS_GRACE_SECONDS: i64 = 120;
    require!(
        (start_timestamp as i64) >= Clock::get()?.unix_timestamp - START_TS_GRACE_SECONDS,
        ExponentCoreError::StartTimestampInPast
    );
    require!(
        min_op_size_strip > 0 && min_op_size_merge > 0,
        ExponentCoreError::MinOperationSizeZero
    );

    ctx.accounts.set_vault(
        start_timestamp,
        duration,
        cpi_accounts,
        ctx.accounts.address_lookup_table.key(),
        ctx.bumps.authority,
        interest_bps_fee,
        min_op_size_strip,
        min_op_size_merge,
        curator,
        creator_fee_bps,
        max_py_supply,
    );

    // Seed vault-level emissions at init. The `Vec<EmissionSeed>` is
    // typed/validated off-chain by the curator pre-init (a live
    // `get_sy_state` gives the correct `initial_index` per reward
    // mint). Setting it any later would require re-sizing the vault
    // account and dragging the index forward atomically — simpler to
    // just fix at init and treat emissions as a permanent feature.
    for seed in emissions_seed.into_iter() {
        ctx.accounts.vault.emissions.push(seed.into_info());
    }

    ctx.accounts.set_yield_position();

    // Solana space limitations does not support Anchor creating these initializers

    // create escrow for YT
    create_token_account(
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.escrow_yt.to_account_info(),
        &ctx.accounts.mint_yt.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.token_program,
        &[&[
            ESCROW_YT_SEED,
            ctx.accounts.vault.key().as_ref(),
            &[ctx.bumps.escrow_yt],
        ]],
    )?;

    msg!("Escrow YT created");
    // create escrow for SY
    create_associated_token_account_2022(
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.mint_sy.to_account_info(),
        &ctx.accounts.escrow_sy.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    // Create an account for the vault robot with the SY Program
    cpi_init_sy_personal_account(ctx.accounts.sy_program.key(), ctx.remaining_accounts)?;

    if enable_metadata {
        ctx.accounts
            .create_metadata(pt_metadata_name, pt_metadata_symbol, pt_metadata_uri)?;
    }

    Ok(())
}
