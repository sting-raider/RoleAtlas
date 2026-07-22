const tabs = Array.from(document.querySelectorAll('[role="tab"][data-view]'));
const panels = Array.from(document.querySelectorAll("[data-panel]"));

function selectView(name) {
  tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.view === name)));
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
    panel.classList.toggle("is-active", panel.dataset.panel === name);
  });
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectView(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    selectView(next.dataset.view);
    next.focus();
  });
});
