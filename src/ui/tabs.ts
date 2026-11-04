// ============================================================
// HipCreep — results organised in tabs
// ------------------------------------------------------------
// The report and the series page are built as a list of <section>s. tabify()
// groups them by the title of each section into tabs, shows one tab at a time
// and remembers the last tab chosen (per page kind) while the page is open and,
// when available, in the browser storage. Sections whose title matches no tab
// stay where they are; `pinned` sections go below the tabs and are always visible.
// ============================================================

export interface TabSpec {
  id: string;
  label: string;
  /** Section titles (h2 text) that belong to this tab */
  match: RegExp;
}

const memory = new Map<string, string>();
const load = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function tabify(root: HTMLElement, tabs: TabSpec[], storeKey: string, pinned?: RegExp, defaultId?: string): void {
  const sections = Array.from(root.querySelectorAll<HTMLElement>(':scope > section.section'));
  const byTab = new Map<string, HTMLElement[]>();
  let first: HTMLElement | null = null;
  const bottom: HTMLElement[] = [];
  for (const sec of sections) {
    const title = (sec.querySelector(':scope > h2') ?? sec.querySelector('summary'))?.textContent ?? '';
    if (pinned && pinned.test(title)) { bottom.push(sec); continue; }
    const t = tabs.find((x) => x.match.test(title));
    if (!t) continue;
    if (!first) first = sec;
    sec.dataset.tab = t.id;
    if (!byTab.has(t.id)) byTab.set(t.id, []);
    byTab.get(t.id)!.push(sec);
  }
  const present = tabs.filter((t) => byTab.has(t.id));
  if (!first || present.length < 2) return;
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.setAttribute('role', 'tablist');
  root.insertBefore(bar, first);
  // keep the sections of each tab together, in tab order, right after the bar
  let anchor: Node = bar;
  for (const t of present) for (const sec of byTab.get(t.id)!) { anchor.parentNode!.insertBefore(sec, anchor.nextSibling); anchor = sec; }
  for (const sec of bottom) root.appendChild(sec);
  const show = (id: string) => {
    for (const t of present) {
      const on = t.id === id;
      for (const sec of byTab.get(t.id)!) sec.hidden = !on;
      const b = bar.querySelector<HTMLButtonElement>(`button[data-id="${t.id}"]`);
      if (b) { b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); }
    }
    memory.set(storeKey, id);
    save(`hipcreep-tab-${storeKey}`, id);
    window.dispatchEvent(new Event('resize'));        // charts drawn while hidden re-measure
  };
  for (const t of present) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.dataset.id = t.id;
    b.setAttribute('role', 'tab');
    b.textContent = t.label;
    b.addEventListener('click', () => show(t.id));
    bar.appendChild(b);
  }
  const wanted = memory.get(storeKey) ?? load(`hipcreep-tab-${storeKey}`);
  const fallback = defaultId && present.some((t) => t.id === defaultId) ? defaultId : present[0].id;
  show(present.some((t) => t.id === wanted) ? wanted! : fallback);
}
