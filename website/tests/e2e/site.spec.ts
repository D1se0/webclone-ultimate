import { expect, test } from '@playwright/test';

test.describe('WebClone Ultimate · web pública', () => {
  test('carga sin errores y presenta el laboratorio y la documentación', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('memoria');
    await expect(page.getByRole('link', { name: /ver en github/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /mira cómo se congela/i })).toBeVisible();
    await expect(page.locator('#docs')).toBeAttached();
    await expect(page.locator('#compatibilidad')).toBeAttached();
    expect(errors).toEqual([]);
  });

  test('ejecuta la captura y permite comparar original y clon', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /ejecutar captura/i }).click();
    await expect(page.getByText(/captura completada/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('0.00% diff')).toBeVisible();
    const slider = page.getByRole('slider', { name: /comparar original y clon/i });
    await slider.fill('30');
    await expect(slider).toHaveValue('30');
  });

  test('persiste el tema y navega por las secciones', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /activar tema claro/i });
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('link', { name: 'Compatibilidad' }).first().click();
    await expect(page.locator('#compatibilidad')).toBeInViewport();
  });

  test('usa las pestañas, el ZIP y el FAQ', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: /JS local y respuestas grabadas/i }).click();
    await expect(page.getByRole('heading', { name: /javascript sigue vivo/i })).toBeVisible();
    await page.getByRole('button', { name: /network\/responses.json/i }).click();
    await expect(page.getByRole('heading', { name: 'network/responses.json' })).toBeVisible();
    await page.getByRole('tab', { name: 'Empaquetar' }).click();
    await expect(page.getByText(/webclone-ultimate-chrome-1.2.0.zip/)).toBeVisible();
    await page.getByRole('button', { name: /esto sube mis páginas/i }).click();
    await expect(page.getByRole('button', { name: /esto sube mis páginas/i })).toHaveAttribute('aria-expanded', 'false');
  });

  test('no genera desbordamiento horizontal', async ({ page }) => {
    await page.goto('/');
    await page.locator('footer').scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('WebClone Ultimate · navegación móvil', () => {
  test('abre el menú y navega a documentación', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const burger = page.getByRole('button', { name: /abrir menú/i });
    await expect(burger).toBeVisible();
    await burger.click();
    await expect(page.locator('#mobile-menu')).toHaveClass(/is-open/);
    await page.locator('#mobile-menu').getByRole('link', { name: /documentación/i }).click();
    await expect(page.locator('#docs')).toBeInViewport();
  });
});
