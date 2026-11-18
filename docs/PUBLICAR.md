# Publicar en GitHub

## Nombre y URLs

| Dato | Valor |
|---|---|
| Propietario | `D1se0` |
| Repositorio | **`webclone-ultimate`** |
| URL del repositorio | `https://github.com/D1se0/webclone-ultimate` |
| URL de GitHub Pages | `https://d1se0.github.io/webclone-ultimate/` |
| Rama principal | `main` |

Comprobado el 18/11/2026: `https://github.com/D1se0/webclone-ultimate` devuelve **404**, es decir, el
nombre está libre en ese propietario. Si se publica en una organización, cambia las URLs y los badges
del README antes del primer push.

## Clave RSA de despliegue

Se ha generado un par RSA de 4096 bits específico para este repositorio:

```text
Pública:    docs/DEPLOY_KEY.pub
Privada:    ~/.ssh/webclone_ultimate_deploy   (NO se copia al repositorio)
Fingerprint: SHA256:TJ5MqXeK76UXfknynvrbKsoeNH/SofFz1vgpZ8qApbk
Comentario:  webclone-ultimate-deploy
```

**Importante:** a GitHub se le da la clave **pública**. La privada no se sube al repositorio, no se
pega en un issue y no se guarda en una variable pública. Si alguien la obtiene, puede escribir en el
repositorio mientras la deploy key siga activa.

### Si el repositorio se crea a mano

1. Crea un repositorio **vacío** llamado `webclone-ultimate` en `D1se0`.
2. No marques “Add a README”, “Add .gitignore” ni “Choose a license”: ya están en el árbol local.
3. Abre **Settings → Deploy keys → Add deploy key**.
4. Pega el contenido completo de [`DEPLOY_KEY.pub`](DEPLOY_KEY.pub).
5. Marca **Allow write access**.
6. Guarda la clave.

Con esa clave registrada, el push desde esta máquina es:

```bash
cd proyect_github
git remote add origin git@github.com:D1se0/webclone-ultimate.git
GIT_SSH_COMMAND='ssh -i ~/.ssh/webclone_ultimate_deploy -o IdentitiesOnly=yes' \
  git push -u origin main
```

Si prefieres usar una clave de cuenta en lugar de una deploy key, añade la misma clave pública en
**Settings → SSH and GPG keys**. La deploy key es más limitada: solo puede escribir en este
repositorio, que es justo lo que necesitamos.

### Por qué no se usa una “variable de keys” de Actions

Una variable de repositorio no autentica un push desde esta máquina. Para publicar se necesita una
clave SSH registrada en GitHub o un token con permiso `repo`. Las GitHub Actions ya usan el
`GITHUB_TOKEN` efímero que GitHub inyecta; no hace falta guardar una RSA privada como secreto para
este repositorio. Si en el futuro otro workflow tuviera que escribir en un repo distinto, se usaría un
**Actions secret** con la clave privada, nunca una variable visible.

## Activar GitHub Pages

1. Entra en **Settings → Pages**.
2. En **Build and deployment → Source**, elige **GitHub Actions**.
3. Ve a **Actions** y ejecuta `Deploy website to GitHub Pages` o haz push a `main` tocando `website/`.
4. Espera al job `Deploy Pages`; la URL aparecerá en el entorno `github-pages`.
5. La web se publica desde `website/dist`, con base relativa y `.nojekyll`.

El workflow [`pages.yml`](../.github/workflows/pages.yml) hace:

```text
checkout → Node 22 → npm ci → npm test → npm run build
        → configure-pages → upload-pages-artifact → deploy-pages
```

No se publica `node_modules`, `src` sin compilar ni el portal antiguo.

## Activar CI

El workflow [`ci.yml`](../.github/workflows/ci.yml) se ejecuta en cada push y pull request:

- Extensión: typecheck, 48 unitarios, build, ZIPs y `web-ext lint`.
- Web: typecheck, 6 unitarios, build estático y 12 E2E (escritorio + móvil).
- Extensión E2E local: 6 pruebas con Chromium y la extensión real.
- La suite externa de `protocolexplorer.org` se ejecuta aparte en
  [`external-e2e.yml`](../.github/workflows/external-e2e.yml), manualmente o cada lunes.

Para que los workflows puedan crear releases, **Settings → Actions → General → Workflow
permissions** debe permitir `Read and write permissions` o el workflow debe declarar
`permissions: contents: write` (ya lo declara `release.yml`).

## Primera release

```bash
git tag v1.2.0
git push origin v1.2.0
```

Las notas se leen de `docs/releases/<tag>.md`; deben existir antes de crear el tag. El tag dispara
[`release.yml`](../.github/workflows/release.yml), que valida, construye y adjunta:

```text
webclone-ultimate-chrome-1.2.0.zip
webclone-ultimate-firefox-1.2.0.zip
SHA256SUMS.txt
```

El workflow crea la release con `--notes-file`, no con las notas automáticas de GitHub. Si la release
ya existe, vuelve a subir los assets con `--clobber`, lo que permite reintentar el job sin crear una
release duplicada.

## Checklist antes de hacer público el repositorio

- [ ] `git status` no muestra `node_modules`, `dist`, `artifacts`, `reports` ni claves privadas.
- [ ] `docs/DEPLOY_KEY.pub` contiene solo la clave pública.
- [ ] `npm run check` pasa.
- [ ] `npm --prefix website run test:e2e` pasa.
- [ ] Pages está en **GitHub Actions**, no en “Deploy from a branch”.
- [ ] La licencia MIT y el README tienen el propietario correcto.
- [ ] No hay capturas con datos personales en issues, tests o commits.

## Dominio propio opcional

En **Settings → Pages → Custom domain** se puede añadir un dominio. GitHub crea un archivo `CNAME` en
la rama de Pages; como la web se despliega como artifact, hay que añadir `website/public/CNAME` con el
dominio y volver a desplegar. Para HTTPS, espera a que GitHub emita el certificado.
