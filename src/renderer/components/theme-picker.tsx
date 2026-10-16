// Settings → General → Appearance: one card per theme with a tiny mock of the sidebar and rows in that theme's colours.
import { THEMES, type ThemeName } from '../../shared/themes-meta';
import { api, ui } from '../model';
import { resolveTokens } from '../themes';

const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

function Preview({ theme }: { theme: ThemeName }) {
  const t = resolveTokens(theme, prefersDark());
  const kinds = [t.owe, t.wait, t.bring, t.said];
  const bar = (w: number, c: string, h = 4) => <span style={{ display: 'block', width: `${w}%`, height: h, borderRadius: 2, background: c }} />;
  return (
    <span class="theme-prev" aria-hidden="true" style={{ background: t.bg, borderColor: t.hairline }}>
      <span class="theme-prev-side" style={{ background: t.surface, borderColor: t.hairline }}>
        {bar(70, t.text, 3)}{bar(55, t.text2, 3)}{bar(60, t.text2, 3)}
        <span style={{ display: 'block', width: 10, height: 5, borderRadius: 3, background: t.clay, marginTop: 'auto' }} />
      </span>
      <span class="theme-prev-rows">
        {kinds.map((k, i) => (
          <span key={i} class="theme-prev-row" style={i === 1 ? { background: t.selected } : undefined}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', border: `1px solid ${t.text2}`, flex: 'none' }} />
            <span style={{ flex: 1 }}>{bar(i % 2 ? 62 : 80, t.text)}</span>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: k, flex: 'none' }} />
            <span style={{ width: 14 }}>{bar(100, t.text2)}</span>
          </span>
        ))}
        <span style={{ display: 'block', width: 30, height: 5, borderRadius: 3, background: t.accent, marginTop: 'auto' }} />
      </span>
    </span>
  );
}

export function ThemePicker() {
  const current = ui.value.theme;
  return (
    <div class="theme-grid" role="radiogroup" aria-label="Theme">
      {THEMES.map((m) => {
        const on = current === m.id;
        return (
          <button type="button" key={m.id} role="radio" aria-checked={on} aria-label={m.label} data-theme-id={m.id} class={`theme-card ${on ? 'on' : ''}`} onClick={() => void api.setUiState({ theme: m.id })}>
            <Preview theme={m.id} />
            <span class="theme-name">
              <span class="ellipsis" title={m.label}>{m.label.replace(/ \(.*\)$/, '')}</span>
              {on && <span class="theme-check" aria-hidden="true">✓</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
