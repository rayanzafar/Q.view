// Opportunities kanban: as demo.bd the board must render stage columns with cards, and the cards
// must carry the drag-and-drop wiring (draggable + Sanad.kStart handlers + data-stage drop
// targets). A real drag simulation is deliberately skipped (HTML5 DnD is flaky under CDP) —
// asserting the wiring attributes pins the same contract the client JS binds to.
import { login, open } from './_helpers.mjs';

export default async function kanbanSpec({ browser, base, t }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, base, 'demo.bd');
  await open(page, base, '/app/opportunities');

  const board = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.kanban .kcol')];
    const cards = [...document.querySelectorAll('.kanban .kcard')];
    return {
      cols: cols.length,
      colsWithStage: cols.filter((c) => c.dataset.stage).length,
      dropWired: cols.filter((c) => (c.getAttribute('ondragover') || '') + (c.getAttribute('ondrop') || '')).length,
      cards: cards.length,
      draggable: cards.filter((c) => c.getAttribute('draggable') === 'true').length,
      dragWired: cards.filter((c) => (c.getAttribute('ondragstart') || '').includes('kStart')).length,
      withId: cards.filter((c) => c.dataset.id).length,
    };
  });

  if (board.cols >= 4 && board.colsWithStage === board.cols) t.pass(`kanban renders ${board.cols} stage columns (all carry data-stage)`);
  else t.fail('kanban columns', `cols=${board.cols} withStage=${board.colsWithStage}`);

  if (board.cards >= 3 && board.withId === board.cards) t.pass(`kanban renders ${board.cards} opportunity cards (all carry data-id)`);
  else t.fail('kanban cards', `cards=${board.cards} withId=${board.withId}`);

  if (board.draggable === board.cards && board.dragWired === board.cards && board.dropWired === board.cols) {
    t.pass('dnd wiring present: draggable cards + kStart handlers + drop targets on every column');
  } else {
    t.fail('dnd wiring', `draggable=${board.draggable}/${board.cards} kStart=${board.dragWired}/${board.cards} drop=${board.dropWired}/${board.cols}`);
  }
  await ctx.close();
}
