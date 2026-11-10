# Publicar PhoneGest Barcode Studio

El origen del actualizador es el repositorio público [ImPaul17/phonegest-barcode-studio](https://github.com/ImPaul17/phonegest-barcode-studio). Solo se distribuyen versiones estables de Windows x64. Los identificadores se procesan localmente; las comprobaciones de versiones y descargas usan GitHub.

## Una versión para toda la aplicación

La versión actual es **1.0.4c**. `package.json.version`, los campos propios del lockfile, el paquete instalado, `app.getVersion()`, `latest.yml` y los nombres de los ejecutables utilizan exactamente ese valor. La Release utiliza la tag **`v1.0.4c`**. No se mantiene otra versión numérica ni se crean tags de compatibilidad para publicaciones nuevas.

Las mejoras pequeñas avanzan una letra minúscula: **1.0.4c**, **1.0.4d**, **1.0.4e**, etc. El comparador del actualizador ordena primero los tres componentes numéricos y después la revisión: **1.0.4 < 1.0.4a < 1.0.4b < 1.0.4c < 1.0.5**. Se admite una sola letra de `a` a `z`; después de `z`, incrementa la versión base.

Los campos binarios fijos de los recursos de Windows solo admiten números. El empaquetado representa la revisión con un cuarto componente: **1.0.4c → 1.0.4.3**. Ese campo de Windows no sustituye la versión de la aplicación, que sigue siendo **1.0.4c**, ni introduce una versión paralela como `1.0.5`.

## Preparar una versión

Para publicar, por ejemplo, **1.0.4d**:

1. Actualiza `package.json.version` a `1.0.4d` y los dos campos de versión propios de `package-lock.json`: el de la raíz y el de `packages[""]`.
2. Pon `releaseInfo.releaseName: 1.0.4d` en `electron-builder.yml`.
3. Actualiza los nombres de descarga y la versión actual en `README.md`.
4. Regenera los avisos y ejecuta las comprobaciones.

```powershell
node scripts/update-notices.mjs
npm run build
npm test
npm run test:ui
npm run test:updates:ui
npm run smoke
npm run test:pdf
npm run test:png
npm run package -- --publish never
npm run release:validate
```

No uses `npm version patch`: incrementaría la base numérica en lugar de avanzar la letra de revisión. La versión debe tener el formato `X.Y.Z` o `X.Y.Z` seguido de una letra minúscula, sin ceros iniciales, sufijos preliminares ni metadatos adicionales.

Revisa y confirma los cambios, súbelos a `main` y espera al resultado de **Comprobar Windows** en Actions. Después crea una tag que coincida exactamente con la versión de `package.json`:

```powershell
git tag -a v1.0.4d -m "PhoneGest Barcode Studio 1.0.4d"
git push origin v1.0.4d
```

La letra es parte de la versión, también para el instalador y el actualizador. No reutilices tags ni rebajes versiones. El flujo rechaza diferencias entre tag, paquete y versión visible, y no sustituye publicaciones ya terminadas.

## Flujo de publicación

[Publicar Windows](../.github/workflows/release.yml) se activa al subir una tag `v*`. También permite una ejecución manual indicando una **tag existente**; nunca crea tags. Usa Windows, Node.js 24 y `npm ci` con el lockfile.

Comprueba TypeScript, motor, actualizador, interfaz, exportaciones reales y contenido de `app.asar`. Genera instalador y portable en una única invocación de empaquetado con `--publish never`, y valida el ejecutable empaquetado y los códigos exportados.

El permiso `contents: write` y el token temporal `GITHUB_TOKEN` pertenecen al trabajo de publicación. El token solo se entrega a los pasos de GitHub CLI. No se incrusta en la aplicación ni hace falta un token personal para este repositorio público.

El flujo crea un borrador de GitHub Release, sube todos los archivos y publica al terminar. Así, `latest.yml` solo se anuncia cuando el instalador está disponible. Los informes y capturas se conservan como artefactos de Actions durante 14 días. No hay un segundo flujo de aliases ni tags internas diferentes.

| Archivo | Uso |
| --- | --- |
| `PhoneGest-Barcode-Studio-1.0.4c-Instalador.exe` | Instalador NSIS y archivo descargado por el actualizador. |
| `PhoneGest-Barcode-Studio-1.0.4c-Instalador.exe.blockmap` | Mapa de bloques del instalador. |
| `latest.yml` | Versión `1.0.4c`, `releaseName` idéntico, nombre, tamaño y SHA512 exactos del instalador. |
| `PhoneGest-Barcode-Studio-1.0.4c-Portable.exe` | Descarga manual de la edición portable. |

`scripts/release-validation.mjs` verifica versiones, hashes, tamaños, nombres y que el blockmap cubra el instalador. Registra también SHA256 de los cuatro archivos en `release/release-validation.json`. El portable no debe aparecer como archivo instalable en `latest.yml`.

No subas PDF originales, proyectos `.pgbs`, sesiones, códigos de clientes ni carpetas de trabajo. El flujo solo publica los cuatro nombres previstos. Sus pruebas utilizan los ejemplos incluidos en el código.

## Transición a 1.0.4c y actualizaciones

Los clientes publicados antes de **1.0.4c**, incluida la edición mostrada como **1.0.4b** y empaquetada como **1.0.5**, solo admitían versiones numéricas. Bloquean las rutas con letras y no pueden instalar automáticamente esta transición. Es necesario descargar y ejecutar una vez el instalador **1.0.4c** desde [GitHub Releases](https://github.com/ImPaul17/phonegest-barcode-studio/releases/latest). La edición portable se sustituye descargando el nuevo portable.

Desde **1.0.4c**, el actualizador compara directamente las versiones con letras y descarga las nuevas en segundo plano. Espera a **Reiniciar e instalar** y guarda antes la sesión. No usa versiones preliminares ni permite bajar de versión. Las releases históricas y sus archivos conservan su contenido original; no se rebautizan binarios antiguos como si fueran la nueva versión.

La red del actualizador está separada de la interfaz y limitada a las rutas del repositorio y a la infraestructura de archivos de GitHub. No recibe datos de documentos. No amplíes sus reglas a destinos arbitrarios ni añadas credenciales al programa.

Los paquetes actuales no están firmados. `verifyUpdateCodeSignature: false` permite actualizar esta distribución sin certificado; se comprueba SHA512 sobre HTTPS. Esto no verifica de forma independiente la identidad del editor. Si se incorpora un certificado, activa y prueba la comprobación de firma en instalador y actualizaciones. Protege la cuenta y permisos del repositorio: controlan el software que reciben los equipos.

## Recuperar una publicación interrumpida

Si el trabajo falla antes de publicar, corrige la causa y vuelve a ejecutarlo para la misma tag desde Actions. Un borrador puede reutilizarse y completar sus archivos. Si la corrección cambia código, crea una versión y tag nuevas.

El flujo rechaza modificar una Release ya publicada. No cambies sus ejecutables ni `latest.yml`: los equipos pueden haber almacenado hashes o descargas. Publica la corrección con la siguiente letra o una versión base superior.

Revisa los cuatro archivos y el resultado de Actions. Instala en un perfil de prueba y abre **Actualizaciones** desde la cabecera. Validar todo el ciclo de actualización requiere publicar una versión superior; una comprobación de “ya estás actualizado” no valida por sí sola la instalación.

Referencias: [GitHub CLI: crear una Release](https://cli.github.com/manual/gh_release_create), [tags y ejecución manual de GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
