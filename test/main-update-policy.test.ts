import { describe, expect, it } from 'vitest';
import { bundleProblem, cleanVersion, isAllowedFeedUrl, isNewer, manualResult, promptText, shouldAsk, signerKind } from '../src/main/update-policy';

describe('cleanVersion', () => {
  it('accepts release versions and rejects anything else', () => {
    expect(cleanVersion('0.2.0')).toBe('0.2.0');
    expect(cleanVersion('1.10.3-beta.2')).toBe('1.10.3-beta.2');
    expect(cleanVersion('v0.2.0')).toBeNull();
    expect(cleanVersion('0.2.0<script>')).toBeNull();
    expect(cleanVersion('')).toBeNull();
    expect(cleanVersion(42)).toBeNull();
    expect(cleanVersion(undefined)).toBeNull();
  });
});

describe('promptText', () => {
  it('names the version and offers Update and restart or Later', () => {
    const t = promptText({ version: '0.2.0' });
    expect(t.message).toContain('0.2.0');
    expect(t.buttons).toEqual(['Update and restart', 'Later']);
  });
  it('makes Return mean Later, so typing when the prompt appears cannot accept it', () => {
    const t = promptText({ version: '0.2.0' });
    expect(t.buttons[t.defaultId]).toBe('Later');
    expect(t.buttons[t.cancelId]).toBe('Later');
  });
});

describe('shouldAsk', () => {
  it('always asks after a manual check', () => {
    expect(shouldAsk({ manual: true, declined: '0.2.0', version: '0.2.0' })).toBe(true);
  });
  it('does not nag about a version the user already put off', () => {
    expect(shouldAsk({ manual: false, declined: '0.2.0', version: '0.2.0' })).toBe(false);
  });
  it('asks about a newer version, and when nothing was declined', () => {
    expect(shouldAsk({ manual: false, declined: '0.2.0', version: '0.2.1' })).toBe(true);
    expect(shouldAsk({ manual: false, declined: null, version: '0.2.0' })).toBe(true);
  });
});

describe('signerKind', () => {
  it('recognises a Developer ID signature', () => {
    const out = 'Executable=/Applications/Jaffloop.app/Contents/MacOS/Jaffloop\nIdentifier=com.jafforge.jaffloop\nAuthority=Developer ID Application: Example Developer (ABCDE12345)\nAuthority=Developer ID Certification Authority\nTeamIdentifier=ABCDE12345\n';
    expect(signerKind(out)).toBe('developer-id');
  });
  it('tells ad-hoc from unsigned', () => {
    expect(signerKind('Identifier=com.jafforge.jaffloop\nSignature=adhoc\nTeamIdentifier=not set\n')).toBe('adhoc');
    expect(signerKind('/x/Jaffloop.app: code object is not signed at all\n')).toBe('unsigned');
    expect(signerKind('')).toBe('unsigned');
    expect(signerKind('Authority=Apple Development: Someone (ABC)\n')).toBe('unsigned');
  });
});

describe('isNewer', () => {
  it('compares numerically, not as text', () => {
    expect(isNewer('0.2.0', '0.1.1')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.1', '0.1.1')).toBe(false);
    expect(isNewer('0.1.0', '0.1.1')).toBe(false);
  });
  it('never calls a different build of the same version newer, and rejects what is not a version', () => {
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false);
    expect(isNewer('nope', '0.1.1')).toBe(false);
    expect(isNewer('0.2.0', 'dev')).toBe(false);
  });
});

describe('manualResult', () => {
  const base = { current: '0.1.1' };
  it('answers every outcome of Check for Updates… in plain words', () => {
    expect(manualResult({ ...base, status: 'uptodate' })).toMatchObject({ message: 'Jaffloop is up to date', releases: false });
    expect(manualResult({ ...base, status: 'uptodate' })!.detail).toContain('0.1.1');
    expect(manualResult({ ...base, status: 'downloading', version: '0.2.0' })!.message).toContain('0.2.0');
    expect(manualResult({ ...base, status: 'downloading', version: '0.2.0' })!.detail).toMatch(/ask/i);
    expect(manualResult({ ...base, status: 'unavailable' })).toMatchObject({ message: 'Updates are off in this build', releases: true });
    expect(manualResult({ ...base, status: 'error', error: 'offline' })).toMatchObject({ message: 'Could not check for updates', detail: 'offline', releases: true });
  });
  it('says nothing when the prompt itself is the answer', () => {
    expect(manualResult({ ...base, status: 'ready', version: '0.2.0' })).toBeNull();
    expect(manualResult({ ...base, status: 'checking' })).toBeNull();
    expect(manualResult({ ...base, status: 'idle' })).toBeNull();
  });
});

describe('isAllowedFeedUrl', () => {
  it('allows https anywhere and plain http only on this machine', () => {
    expect(isAllowedFeedUrl('https://example.com/feed')).toBe(true);
    expect(isAllowedFeedUrl('http://127.0.0.1:8765')).toBe(true);
    expect(isAllowedFeedUrl('http://localhost:3000/updates')).toBe(true);
    expect(isAllowedFeedUrl('http://[::1]:8000')).toBe(true);
    expect(isAllowedFeedUrl('http://example.com/feed')).toBe(false);
    expect(isAllowedFeedUrl('http://127.0.0.1.evil.com/')).toBe(false);
    expect(isAllowedFeedUrl('file:///tmp/feed')).toBe(false);
    expect(isAllowedFeedUrl('')).toBe(false);
  });
});

describe('bundleProblem', () => {
  it('says why an app that cannot replace itself will not check for updates', () => {
    expect(bundleProblem('/Applications/Jaffloop.app', true)).toBeNull();
    expect(bundleProblem('/Users/me/Applications/Jaffloop.app', true)).toBeNull();
    expect(bundleProblem('/private/var/folders/xx/T/AppTranslocation/ABC/d/Jaffloop.app', true)).toMatch(/Applications folder/);
    expect(bundleProblem('/Volumes/Jaffloop 0.2.0/Jaffloop.app', false)).toMatch(/Applications folder/);
    expect(bundleProblem('/Applications/Jaffloop.app', false)).toMatch(/cannot replace itself/i);
  });
});

describe('manualResult with a reason', () => {
  it('shows the reason an unavailable build gives instead of the generic text', () => {
    const r = manualResult({ status: 'unavailable', current: '0.2.0', error: 'Move Jaffloop to your Applications folder.' });
    expect(r!.detail).toContain('Move Jaffloop to your Applications folder.');
    expect(r!.releases).toBe(true);
  });
});
