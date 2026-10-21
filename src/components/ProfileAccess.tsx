'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, CheckCircle, Files, ListChecks, LockSimple, Signpost, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import { WORKSPACE_PROFILES, type ProfileId } from '@/lib/migration/profiles';

type ProfileAccessProps = {
  onSuccess: () => Promise<void>;
  compact?: boolean;
};

/** The profile labels are public. The workspace PIN is checked only by the server. */
export function ProfileAccess({ onSuccess, compact = false }: ProfileAccessProps) {
  const [profileId, setProfileId] = useState<ProfileId | ''>('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pinInvalid, setPinInvalid] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const selected = WORKSPACE_PROFILES.find(profile => profile.id === profileId);
  const ready = Boolean(selected && /^[0-9]{6}$/.test(pin));

  function chooseProfile(id: ProfileId) {
    setProfileId(id);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    setPinInvalid(false);
    let focusPin = false;
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, pin }),
      });
      const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) {
        if (response.status === 401) {
          setPin('');
          setPinInvalid(true);
          focusPin = true;
        }
        throw new Error(result?.error?.message || 'We couldn’t open the workspace. Please try again.');
      }
      setPin('');
      await onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We couldn’t open the workspace. Please try again.');
    } finally {
      setBusy(false);
      if (focusPin) requestAnimationFrame(() => pinRef.current?.focus({ preventScroll: true }));
    }
  }

  const form = (
    <form className="profile-access__form" onSubmit={submit} aria-busy={busy}>
      {!compact && <div className="profile-access__welcome">
        <span className="profile-access__welcome-icon" aria-hidden="true"><LockSimple size={22} weight="duotone" /></span>
        <p className="profile-access__eyebrow">Your project workspace</p>
        <h2>Welcome back.</h2>
        <p>Choose your profile to pick up where the team left off.</p>
      </div>}

      <fieldset className="profile-access__profiles" disabled={busy} aria-describedby={`${formId}-profile-hint`}>
        <legend>Choose your profile</legend>
        <div className="profile-access__profile-grid">
          {WORKSPACE_PROFILES.map(profile => (
            <label className={`profile-access__profile ${profile.id === profileId ? 'is-selected' : ''}`} key={profile.id}>
              <input
                type="radio"
                name={`${formId}-profile`}
                value={profile.id}
                checked={profile.id === profileId}
                onChange={() => chooseProfile(profile.id)}
                aria-label={`${profile.name}, ${profile.roleLabel}`}
                required
              />
              <span className={`profile-access__initial profile-access__initial--${profile.id}`} aria-hidden="true">{profile.name.charAt(0)}</span>
              <span className="profile-access__profile-copy"><strong>{profile.name}</strong><small>{profile.roleLabel}</small></span>
              <span className="profile-access__profile-check" aria-hidden="true">{profile.id === profileId && <Check size={11} weight="bold" />}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={`profile-access__role ${selected?.canApprove ? 'can-approve' : ''}`} id={`${formId}-profile-hint`} aria-live="polite" aria-atomic="true">
        {selected?.canApprove ? <CheckCircle size={18} aria-hidden="true" /> : <ListChecks size={18} aria-hidden="true" />}
        <p>{selected
          ? selected.canApprove
            ? 'You can update the workspace and approve URL decisions.'
            : 'You can update the workspace and prepare decisions. Dennis and Maddy record approvals.'
          : 'Changes are recorded under your profile. Dennis and Maddy can approve URL decisions.'}</p>
      </div>

      <div className="profile-access__pin-field">
        <label htmlFor={`${formId}-pin`}>Workspace PIN <span aria-hidden="true">6 digits</span></label>
        <div className={`profile-access__pin-wrap ${pinInvalid ? 'has-error' : ''}`}>
          <LockSimple size={19} aria-hidden="true" />
          <input
            ref={pinRef}
            id={`${formId}-pin`}
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            autoComplete="current-password"
            autoCapitalize="off"
            spellCheck={false}
            value={pin}
            onChange={event => { setPin(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); setPinInvalid(false); }}
            placeholder="Enter the shared PIN"
            aria-describedby={`${formId}-pin-hint${error ? ` ${formId}-error` : ''}`}
            aria-invalid={pinInvalid ? true : undefined}
            disabled={busy}
            required
          />
          <span className="profile-access__pin-count" aria-hidden="true">{pin.length}/6</span>
        </div>
        <p id={`${formId}-pin-hint`}>Use the six-digit PIN shared with the project team.</p>
      </div>

      {error && <p className="profile-access__error" id={`${formId}-error`} role="alert"><WarningCircle size={19} aria-hidden="true" /><span>{error}</span></p>}

      <button className="profile-access__submit" type="submit" disabled={!ready || busy}>
        <span>{busy ? 'Opening workspace…' : selected ? `Continue as ${selected.name}` : 'Open workspace'}</span>
        {busy ? <SpinnerGap size={19} className="spin" aria-hidden="true" /> : <ArrowRight size={19} aria-hidden="true" />}
      </button>
      <p className="profile-access__help">Need the PIN? Ask the project owner.</p>
    </form>
  );

  if (compact) return <div className="profile-access profile-access--compact">{form}</div>;

  return <main className="profile-access">
    <div className="profile-access__shell">
      <header className="profile-access__header">
        <div className="profile-access__brand" aria-label="Postalytics"><span>postalytics</span><ArrowUpRight size={29} weight="bold" aria-hidden="true" /></div>
        <span className="profile-access__access-label"><LockSimple size={14} aria-hidden="true" />Private project workspace</span>
      </header>

      <div className="profile-access__layout">
        <section className="profile-access__intro" aria-labelledby={`${formId}-title`}>
          <p className="profile-access__eyebrow">Postalytics · Website migration</p>
          <h1 id={`${formId}-title`}>The migration,<br /><span>all in one place.</span></h1>
          <p className="profile-access__intro-copy">A shared view of the work ahead, the decisions to make, and the detail behind every move.</p>
          <div className="profile-access__features">
            <div><span aria-hidden="true"><ListChecks size={21} /></span><p><strong>Know what’s next</strong><small>Clear actions, owners and progress.</small></p></div>
            <div><span aria-hidden="true"><Signpost size={21} /></span><p><strong>Make every URL count</strong><small>Recommendations and approvals, together.</small></p></div>
            <div><span aria-hidden="true"><Files size={21} /></span><p><strong>Keep the evidence close</strong><small>Reports, spreadsheets and the project record.</small></p></div>
          </div>
        </section>

        <section className="profile-access__panel" aria-label="Sign in to the migration workspace">{form}</section>
      </div>

      <footer className="profile-access__footer"><span className="profile-access__credit"><strong>MADX</strong><span>Prepared for Postalytics</span></span><span>One project. A shared record.</span></footer>
    </div>
  </main>;
}
