import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Standalone 単一HTMLが file:// で動作し、APIなしでも F1 を完了できることを確認する。
 */
test('standalone HTML works offline', async ({ page }) => {
  const url = pathToFileURL(`${process.cwd()}/dist/standalone/index.html`).href;
  await page.goto(url);

  await expect(page.locator('#main')).toContainText('図面の取り込み');
  // API probe fails on file:// and the header switches to offline.
  await expect(page.locator('#api-status')).toHaveText('オフライン', { timeout: 20_000 });

  await page.getByTestId('load-sample').click();
  await expect(page.getByTestId('stat-layers')).toHaveText('20');
  await page.getByTestId('next').click();
  await expect(page.getByTestId('layer-table')).toBeVisible();

  await page.getByTestId('bulk-confirm').click();
  await page.locator('select[data-testid="select-Layer3"]').selectOption('045');
  await expect(page.getByTestId('pending-count')).toHaveText('0');
  await page.getByTestId('next').click();

  await page.getByTestId('apply-all-notes').click();
  await expect(page.getByTestId('top-040')).toHaveValue('2.00');
  await page.getByTestId('next').click();
  await page.getByTestId('generate').click();
  await expect(page.getByTestId('part-count')).toHaveText('29');
  await page.getByTestId('next').click();
  await expect(page.getByTestId('screen-4d')).toBeVisible();
  await expect(page.getByTestId('date-input')).toHaveValue('2027-04-01');
});
