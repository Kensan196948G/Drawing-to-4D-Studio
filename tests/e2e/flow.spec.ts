import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function loadSampleAndOpenAssign(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('load-sample').click();
  await expect(page.getByTestId('stat-layers')).toHaveText('20');
  await page.getByTestId('next').click();
  await expect(page.getByTestId('layer-table')).toBeVisible();
}

async function confirmAll(page: Page): Promise<void> {
  await page.getByTestId('bulk-confirm').click();
  await page.locator('select[data-testid="select-Layer3"]').selectOption('045');
  await expect(page.getByTestId('pending-count')).toHaveText('0');
}

async function goTo4d(page: Page): Promise<void> {
  await page.getByTestId('next').click();
  await expect(page.getByTestId('elevation-table')).toBeVisible();
  await page.getByTestId('apply-all-notes').click();
  await expect(page.getByTestId('top-040')).toHaveValue('2.00');
  await page.getByTestId('next').click();
  await expect(page.getByTestId('screen-generate')).toBeVisible();
  await page.getByTestId('generate').click();
  await expect(page.getByTestId('part-count')).toHaveText('29');
  await page.getByTestId('next').click();
  await expect(page.getByTestId('screen-4d')).toBeVisible();
}

test.describe('Phase 1 flows', () => {
  test('F1: sample → assign → elevation → 3D → 4D → save → reopen', async ({ page }) => {
    await loadSampleAndOpenAssign(page);
    await confirmAll(page);
    await goTo4d(page);

    // 4D controls
    await expect(page.getByTestId('canvas-3d')).toBeVisible();
    await expect(page.getByTestId('date-input')).toBeVisible();
    const startDate = await page.getByTestId('date-input').inputValue();
    expect(startDate).toBe('2027-04-01');

    // Move 180 days by the slider (range input needs a native value set)
    await page.getByTestId('date-slider').evaluate((element) => {
      const input = element as HTMLInputElement;
      input.value = '180';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.getByTestId('date-input')).not.toHaveValue('2027-04-01');
    await page.getByTestId('view-top').click();
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAttribute('aria-label', '停止');
    await page.getByTestId('play').click();

    // Save
    await page.getByTestId('save').click();
    await expect(page.locator('#save-dialog')).toBeVisible();
    await page.locator('#case-code').fill('E2E-CASE');
    await page.locator('#case-name').fill('E2E 岸壁テスト');
    await page.locator('#save-submit').click();
    await expect(page.locator('#save-dialog')).not.toBeVisible();
    await expect(page.locator('#toast')).toContainText('保存しました');

    // Reopen from the dialog (same session)
    await page.locator('#btn-open').click();
    await expect(page.getByTestId('open-case-E2E-CASE')).toBeVisible();
    await page.getByTestId('open-case-E2E-CASE').click();
    await expect(page.getByTestId('screen-4d')).toBeVisible();
    await expect(page.locator('#kpi-parts')).toHaveText('29');

    // Reload and reopen from localStorage (F2)
    await page.reload();
    await expect(page.locator('#main')).toContainText('図面の取り込み');
    await page.locator('#btn-open').click();
    await page.getByTestId('open-case-E2E-CASE').click();
    await expect(page.getByTestId('screen-4d')).toBeVisible();
    await expect(page.locator('#kpi-parts')).toHaveText('29');
    await expect(page.getByTestId('date-input')).toHaveValue('2027-04-01');
  });

  test('F3: manual layer correction is learned for the next import', async ({ page }) => {
    // Isolated layer name so the server-side dictionary from other tests cannot interfere.
    const layer = `E2E-LEARN-${Date.now()}`;
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '1',
      '0', 'LAYER', '2', layer, '70', '0', '62', '1', '6', 'CONTINUOUS',
      '0', 'ENDTAB', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', layer, '90', '4', '70', '1',
      '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '10', '10', '0', '20', '10',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const file = { name: 'learn.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) };

    await page.goto('/');
    await page.locator('#file-input').setInputFiles(file);
    await expect(page.getByTestId('stat-layers')).toHaveText('1');
    await page.getByTestId('next').click();

    const row = page.locator(`[data-testid="row-${layer}"]`);
    await expect(row.locator('.pill')).not.toContainText('100%');
    await page.locator(`select[data-testid="select-${layer}"]`).selectOption('040');
    await expect(row.locator('.pill')).toContainText('100%');

    // Re-import: the learned exact term applies with 100% confidence.
    await page.getByTestId('step-1').click();
    await page.locator('#file-input').setInputFiles(file);
    await page.getByTestId('next').click();
    await expect(page.locator(`[data-testid="row-${layer}"] .pill`)).toContainText('100%');
  });

  test('Empty state and keyboard navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#main')).toContainText('まだ図面がありません');
    await expect(page.getByTestId('step-2')).toHaveAttribute('aria-disabled', 'true');

    // Skip link is the first navigation aid and keyboard-activatable.
    const skip = page.locator('.skip-link');
    await skip.focus();
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });
});
