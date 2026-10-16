import { render } from 'preact';
import './styles.css';
import type { WindowKind } from '../shared/api';
import { initModel } from './model';
import { bootTheme } from './themes';
import { CaptureWindow } from './windows/capture';
import { PopoverWindow } from './windows/popover';
import { SettingsWindow } from './windows/settings';
import { MorningBriefWindow, PersonBriefWindow } from './windows/briefs';
import { MainWindow } from './windows/main';

const view = window.jaffloop.view as WindowKind;
document.body.dataset.view = view;
bootTheme(); // last theme from localStorage, before the first paint; applyUi then applies the saved one
if (view === 'capture' || view === 'popover') document.body.classList.add('transparent');

async function mount() {
  await initModel();
  const root = document.getElementById('root')!;
  switch (view) {
    case 'capture': return render(<CaptureWindow />, root);
    case 'popover': return render(<PopoverWindow />, root);
    case 'settings': return render(<SettingsWindow />, root);
    case 'brief': return render(<PersonBriefWindow />, root);
    case 'morning': return render(<MorningBriefWindow />, root);
    default: return render(<MainWindow />, root);
  }
}
void mount();
