// Mock Meet bridge — everything that knows what Google Meet's pages look like, in one place,
// matched by role and accessible name rather than class names (Meet's classes change weekly).
// When Meet changes its join screen, this is the file to fix.
//
// Evaluated as `(<this file>)(action)`: 'state' says where the page is; 'dismiss', 'name',
// 'join' and 'leave' find that control and return its centre for a real mouse click.
(action) => {
  const JOIN_BUTTON = /^(ask to join|join now|join anyway|join here too|switch here)$/i;
  const LEAVE_BUTTON = /^leave call$/i;
  const NAME_INPUT = /^(your name|what's your name\??)$/i;
  // Dialogs to wave away on the way in. Never "continue without microphone": Mock needs its mic.
  const DISMISS_BUTTON = /^(got it|dismiss|close|ok|no thanks|accept all)$/i;
  const WAITING_TEXT = /asking to be let in|someone in the call (will|needs to) let you in|you'll join the call when someone lets you in|waiting for the host/i;
  const DENIED_TEXT = /you can't join this video call|denied your request|no one responded to your request|you've been removed|you were removed|meeting has ended|call has ended|you left the meeting|check your meeting code|invalid video call name/i;

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: false })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const labelled = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) return norm(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
    return '';
  };
  const buttonName = (el) => norm(el.getAttribute('aria-label')) || labelled(el) || norm(el.innerText || el.value || el.textContent);
  const inputName = (el) => norm(el.getAttribute('aria-label')) || labelled(el) || norm(Array.from(el.labels || []).map((l) => l.textContent).join(' ')) || norm(el.getAttribute('placeholder'));
  const buttons = () => Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
  const textboxes = () => Array.from(document.querySelectorAll('input:not([type]), input[type="text"], textarea, [role="textbox"]'));
  const first = (els, re, name) => els.find((el) => re.test(name(el)) && visible(el)) || null;
  const at = (el) => {
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, enabled: !el.disabled && el.getAttribute('aria-disabled') !== 'true', value: 'value' in el ? String(el.value) : norm(el.textContent) };
  };

  switch (action) {
    case 'state': {
      if (first(buttons(), LEAVE_BUTTON, buttonName)) return { state: 'in_call', text: '' };
      const body = document.body ? document.body.innerText : '';
      const denied = DENIED_TEXT.exec(body);
      if (denied) return { state: 'denied', text: denied[0] };
      if (WAITING_TEXT.test(body)) return { state: 'waiting', text: '' };
      if (first(buttons(), JOIN_BUTTON, buttonName) || first(textboxes(), NAME_INPUT, inputName)) return { state: 'join_screen', text: '' };
      return { state: 'loading', text: '' };
    }
    case 'dismiss': return at(first(buttons(), DISMISS_BUTTON, buttonName));
    case 'name': return at(first(textboxes(), NAME_INPUT, inputName));
    case 'join': return at(first(buttons(), JOIN_BUTTON, buttonName));
    case 'leave': return at(first(buttons(), LEAVE_BUTTON, buttonName));
    default: return null;
  }
}
