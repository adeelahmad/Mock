// Mock Meet bridge — everything that knows what Google Meet's pages look like, in one place,
// matched by role and accessible name rather than class names (Meet's classes change weekly).
// When Meet changes its join screen, this is the file to fix.

import type { Locator, Page } from '@playwright/test';

export const JOIN_BUTTON = /^(ask to join|join now|join anyway|join here too|switch here)$/i;
export const LEAVE_BUTTON = /^leave call$/i;
export const NAME_INPUT = /^(your name|what's your name\??)$/i;
/** Dialogs to wave away on the way in. Never "continue without microphone": Mock needs its mic. */
export const DISMISS_BUTTON = /^(got it|dismiss|close|ok|no thanks|accept all)$/i;
export const WAITING_TEXT = /asking to be let in|someone in the call (will|needs to) let you in|you'll join the call when someone lets you in|waiting for the host/i;
export const DENIED_TEXT = /you can't join this video call|denied your request|no one responded to your request|you've been removed|you were removed|meeting has ended|call has ended|you left the meeting|check your meeting code|invalid video call name/i;

export type PageState = 'in_call' | 'waiting' | 'denied' | 'join_screen' | 'loading';

const visible = async (l: Locator): Promise<boolean> => { try { return await l.first().isVisible(); } catch { return false; } };

export const leaveButton = (p: Page): Locator => p.getByRole('button', { name: LEAVE_BUTTON });
export const joinButton = (p: Page): Locator => p.getByRole('button', { name: JOIN_BUTTON });
export const nameInput = (p: Page): Locator => p.getByRole('textbox', { name: NAME_INPUT });

/** Where the page is right now. */
export async function pageState(p: Page): Promise<{ state: PageState; text: string }> {
  if (await visible(leaveButton(p))) return { state: 'in_call', text: '' };
  const body = await p.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  const denied = DENIED_TEXT.exec(body);
  if (denied) return { state: 'denied', text: denied[0] };
  if (WAITING_TEXT.test(body)) return { state: 'waiting', text: '' };
  if (await visible(joinButton(p)) || await visible(nameInput(p))) return { state: 'join_screen', text: '' };
  return { state: 'loading', text: '' };
}

/** One step on the join screen: dismiss a dialog, type the name, press join. True when it pressed join. */
export async function joinStep(p: Page, botName: string): Promise<boolean> {
  const dismiss = p.getByRole('button', { name: DISMISS_BUTTON });
  if (await visible(dismiss)) await dismiss.first().click({ timeout: 2000 }).catch(() => undefined);
  const name = nameInput(p);
  if (await visible(name) && !(await name.first().inputValue().catch(() => ''))) await name.first().fill(botName, { timeout: 2000 }).catch(() => undefined);
  const join = joinButton(p);
  if (await visible(join) && await join.first().isEnabled().catch(() => false)) {
    await join.first().click({ timeout: 3000 });
    return true;
  }
  return false;
}
