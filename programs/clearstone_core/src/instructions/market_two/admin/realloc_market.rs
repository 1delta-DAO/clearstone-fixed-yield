use anchor_lang::prelude::*;

use crate::MarketTwo;

#[derive(Accounts)]
pub struct ReallocMarket<'info> {
    #[account(
        mut,
        has_one = curator,
    )]
    pub market: Account<'info, MarketTwo>,

    #[account(mut)]
    pub curator: Signer<'info>,

    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}

/// Grow the market account by `additional_bytes`. Curator-gated.
pub fn handler(ctx: Context<ReallocMarket>, additional_bytes: u64) -> Result<()> {
    let market_info = ctx.accounts.market.to_account_info();

    let current_size = market_info.data_len();
    let new_size = current_size + additional_bytes as usize;

    let lamports_required = Rent::get()?.minimum_balance(new_size);
    let lamports_to_transfer = lamports_required
        .checked_sub(market_info.lamports())
        .unwrap_or(0);

    if lamports_to_transfer > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.curator.to_account_info(),
                    to: market_info.clone(),
                },
            ),
            lamports_to_transfer,
        )?;
    }

    market_info.realloc(new_size, false)?;

    Ok(())
}
