/**
 * Réglage « Rythme » : Discret (défaut, recommandé) ou Normal.
 *
 * Pourquoi un composant à part : il apparaît à deux endroits (options
 * avancées du panneau d'export, modale de suppression) et doit se comporter
 * pareil aux deux, avertissement compris.
 *
 * Passer en Normal n'est jamais immédiat : un encart d'avertissement s'ouvre
 * EN LIGNE (pas une modale : le composant vit aussi dans la modale de
 * suppression, et une modale dans une modale se superpose mal dans le Shadow
 * DOM). Revenir en Discret, le choix prudent, est immédiat.
 *
 * La valeur affichée est celle que le moteur diffuse dans son état
 * (`controller.pace`), jamais une copie locale : si le service worker n'a pas
 * pris la commande, l'écran ne prétend pas le contraire.
 */
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { PaceMode } from '../../engine/pacer';
import type { RemoteController } from '../../ui/remote-controller';
import { HelpTip } from '../../ui/HelpTip';
import { t } from '../../ui/i18n';

export function PaceSetting({ controller }: { controller: RemoteController }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const pace = controller.pace;

  async function apply(mode: PaceMode): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      const ok = await controller.setPace(mode);
      if (!ok) setFailed(true);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  function choose(mode: PaceMode): void {
    if (busy || mode === pace) {
      setConfirming(false);
      return;
    }
    if (mode === 'normal') {
      setConfirming(true);
      return;
    }
    void apply('discreet');
  }

  return (
    <div class="v-field v-pace">
      <label>
        {t('pace.label')}
        <HelpTip text={t('pace.help')} />
      </label>
      <div class="v-modeswitch v-pace-switch" role="radiogroup" aria-label={t('pace.label')}>
        <span
          role="radio"
          aria-checked={pace === 'discreet'}
          class={pace === 'discreet' ? 'on' : ''}
          onClick={() => choose('discreet')}
        >
          {t('pace.discreet')}
        </span>
        <span
          role="radio"
          aria-checked={pace === 'normal'}
          class={pace === 'normal' || confirming ? 'on v-pace-normal' : ''}
          onClick={() => choose('normal')}
        >
          {t('pace.normal')}
        </span>
      </div>
      {confirming && (
        <div class="v-pace-warn" role="alertdialog" aria-label={t('pace.warn_title')}>
          <b>{t('pace.warn_title')}</b>
          {/* Court : le panneau fait ~300 px de large et l'utilisateur a déjà lu
              les sanctions dans la modale du premier export. */}
          <p>{t('pace.warn_body')} {t('tos.no_guarantee')}</p>
          <div class="v-pace-warn-actions">
            <button class="v-btn v-btn--ghost" onClick={() => setConfirming(false)}>
              {t('pace.warn_keep')}
            </button>
            <button class="v-btn v-btn-danger" disabled={busy} onClick={() => void apply('normal')}>
              {t('pace.warn_confirm')}
            </button>
          </div>
        </div>
      )}
      {failed && <div class="v-help v-pace-failed">{t('pace.warn_failed')}</div>}
    </div>
  );
}
