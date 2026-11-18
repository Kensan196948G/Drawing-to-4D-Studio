import { expect, test } from '@playwright/test';

/**
 * 設計仕様との比較用に主要画面を保存する。
 * 実行: pnpm exec playwright test tests/e2e/screenshots.spec.ts
 */
test('capture key screens', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('load-sample').click();
  await expect(page.getByTestId('stat-layers')).toHaveText('20');
  await page.screenshot({ path: 'docs/evidence/screens/01-import.png', fullPage: true });

  await page.getByTestId('next').click();
  await expect(page.getByTestId('layer-table')).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/screens/02-assign.png', fullPage: true });

  await page.getByTestId('bulk-confirm').click();
  await page.locator('select[data-testid="select-Layer3"]').selectOption('045');
  await expect(page.getByTestId('pending-count')).toHaveText('0');
  await page.getByTestId('next').click();
  await expect(page.getByTestId('elevation-table')).toBeVisible();
  await page.getByTestId('apply-all-notes').click();
  await expect(page.getByTestId('top-040')).toHaveValue('2.00');
  await page.screenshot({ path: 'docs/evidence/screens/03-elevation.png', fullPage: true });

  await page.getByTestId('next').click();
  await expect(page.getByTestId('screen-generate')).toBeVisible();
  await page.getByTestId('generate').click();
  await expect(page.getByTestId('part-count')).toHaveText('29');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/evidence/screens/04-generate.png', fullPage: true });

  await page.getByTestId('next').click();
  await expect(page.getByTestId('screen-4d')).toBeVisible();
  await page.getByTestId('date-slider').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '260';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByTestId('view-iso').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/evidence/screens/05-4d.png', fullPage: true });

  await page.getByTestId('save').click();
  await page.locator('#case-code').fill('SCREENSHOT-CASE');
  await page.locator('#case-name').fill('画面確認用（架空）');
  await page.screenshot({ path: 'docs/evidence/screens/06-save-dialog.png', fullPage: true });
});
