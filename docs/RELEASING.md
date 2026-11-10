# Publicar PhoneGest Barcode Studio

El origen del actualizador es el repositorio público [ImPaul17/phonegest-barcode-studio](https://github.com/ImPaul17/phonegest-barcode-studio). Solo se distribuyen versiones estables de Windows x64. Los identificadores se procesan localmente; las comprobaciones de versiones y descargas usan GitHub.

## Preparar una versión

La versión pública se define en `package.json.displayVersion`: **1.0.4b**, **1.0.4c**, **1.0.4d**, etc. Las mejoras pequeñas mantienen la base **1.0.4** y avanzan la letra minúscula. Cada versión tiene una tag pública equivalente, como **`v1.0.4b`**, creada automáticamente al terminar la publicación.

`package.json.version`, el lockfile y los ejecutables conservan SemVer numérico estable (actualmente **1.0.5**). La Release mantiene la referencia técnica **`v1.0.5`**, necesaria para los actualizadores ya instalados, y ambas tags apuntan al mismo commit. Cada publicación necesita un número interno superior, también al pasar de **1.0.4b** a **1.0.4c**; esto no cambia la versión pública base.

Incrementa la versión interna y el lockfile juntos, actualiza la etiqueta visible y los avisos. Desde 1.0.4b / interna 1.0.5, por ejemplo:

```powershell
npm version patch --no-git-tag-version
npm pkg set displayVersion=1.0.4c
node scripts/update-notices.mjs
npm run build
npm test
npm run test:ui
npm run test:updates:ui
npm run smoke
npm run test:pdf
npm run test:png
```

Antes de comprobar o empaquetar, pon también `releaseInfo.releaseName: 1.0.4c` en `electron-builder.yml`. Ese dato viaja en `latest.yml` y permite que la app muestre la etiqueta de la próxima versión disponible. Las pruebas y la validación del paquete comprueban que coincide con `displayVersion`.

Revisa y confirma los cambios, súbelos a `main` y espera al resultado de **Comprobar Windows** en Actions. Después crea una etiqueta que coincida exactamente con la versión interna de `package.json`:

```powershell
git tag -a v1.0.6 -m "PhoneGest Barcode Studio 1.0.4c (interna 1.0.6)"
git push origin v1.0.6
```

El número es un ejemplo. No reutilices etiquetas ni reduzcas versiones internas. El flujo rechaza etiquetas técnicas sin `v`, versiones preliminares o diferencias con `package.json.version`. No subas manualmente la tag con letra: al publicarse `v1.0.6`, el flujo crea automáticamente **`v1.0.4c`** en el mismo commit. El título público de la Release utiliza **v1.0.4c PhoneGest Barcode Studio**.

Conserva la tag numérica y la Release asociada: los clientes anteriores bloquean las rutas de actualización con letras. La tag pública identifica la revisión y permite consultar o descargar su código; los ejecutables y `latest.yml` siguen en la Release numérica para mantener las actualizaciones.

## Flujo de publicación

[Publicar Windows](../.github/workflows/release.yml) se activa al subir una etiqueta `v*`. También permite una ejecución manual indicando una **etiqueta existente**; nunca crea etiquetas. Usa Windows, Node.js 24 y `npm ci` con el lockfile.

Comprueba TypeScript, motor, actualizador, interfaz, exportaciones reales y contenido de `app.asar`. Genera instalador y portable en una única invocación con `--publish never`, y valida el ejecutable empaquetado y los códigos exportados.

El permiso `contents: write` y el token temporal `GITHUB_TOKEN` pertenecen al trabajo de publicación. El token solo se entrega a los pasos de GitHub CLI. No se incrusta en la aplicación ni hace falta un token personal para este repositorio público.

El flujo crea un borrador de GitHub Release, sube todos los archivos y publica al terminar. Así, `latest.yml` solo se anuncia cuando el instalador está disponible. Los informes y capturas se conservan como artefactos de Actions durante 14 días.

Después llama a [Sincronizar tags públicas](../.github/workflows/release-tags.yml), que lee la versión visible del commit publicado y crea una tag anotada en ese mismo commit. Utiliza `GITHUB_TOKEN`, de modo que la nueva tag no dispara otra compilación. Si ya existe y coincide, termina correctamente; si apunta a otro commit, falla sin sobrescribirla.

Para recuperar una sincronización interrumpida, ejecuta **Sincronizar tags públicas** desde Actions, selecciona como referencia la tag numérica de la publicación e indica también esa tag en el campo de entrada. Este flujo no vuelve a compilar ni cambia los archivos publicados. Puede repetirse: si la tag pública ya existe en el commit correcto, termina sin cambios.

Si los workflows del commit publicado difieren de los de `main`, GitHub puede denegar la creación de la referencia con `GITHUB_TOKEN`; elegir otra referencia al ejecutar el flujo no evita esta restricción. En ese caso crea la tag con tu acceso Git habitual, sin forzar ni sustituir referencias existentes. Las publicaciones anteriores a la incorporación de este flujo necesitan esa sincronización inicial. La correspondencia inicial es **`v1.0.4b` → commit de `v1.0.5`**; se conserva `v1.0.5` para el actualizador.

```powershell
git fetch origin --tags
git tag -a v1.0.4b 'v1.0.5^{commit}' -m "PhoneGest Barcode Studio 1.0.4b (actualizador: v1.0.5)"
git push origin v1.0.4b
```

Este ejemplo ya está aplicado. Para otra revisión, utiliza su versión pública y la tag numérica correspondiente. Si Git indica que la tag ya existe, verifica el commit; no utilices `--force`.

| Archivo | Uso |
| --- | --- |
| `PhoneGest-Barcode-Studio-X.Y.Z-Instalador.exe` | Instalador NSIS y archivo descargado por el actualizador. |
| `PhoneGest-Barcode-Studio-X.Y.Z-Instalador.exe.blockmap` | Mapa de bloques compatible con Electron Updater. |
| `latest.yml` | Versión interna, etiqueta visible `releaseName`, nombre, tamaño y SHA512 exactos del instalador. |
| `PhoneGest-Barcode-Studio-X.Y.Z-Portable.exe` | Descarga manual de la edición portable. |

`scripts/release-validation.mjs` verifica hashes, tamaños, nombres y que el blockmap cubra el instalador. Registra también SHA256 de los cuatro archivos en `release/release-validation.json`. El portable no debe aparecer como archivo instalable en `latest.yml`.

No subas PDF originales, proyectos `.pgbs`, sesiones, códigos de clientes ni carpetas de trabajo. El flujo solo publica los cuatro nombres previstos. Sus pruebas utilizan los ejemplos incluidos en el código.

## Actualizador y distribución

La edición instalada 1.0.2 o posterior consulta las versiones estables y descarga las nuevas en segundo plano. Espera a **Reiniciar e instalar** y guarda antes la sesión. No usa versiones preliminares ni permite bajar de versión. La portable abre las descargas para cambiar de ejecutable manualmente. La 1.0.1 bloqueaba un redireccionamiento necesario de GitHub y debe sustituirse manualmente por la 1.0.2 o posterior.

La red del actualizador está separada de la interfaz y limitada a las rutas del repositorio y a la infraestructura de archivos de GitHub. No recibe datos de documentos. No amplíes sus reglas a destinos arbitrarios ni añadas credenciales al programa.

Los paquetes actuales no están firmados. `verifyUpdateCodeSignature: false` permite actualizar esta distribución sin certificado; se comprueba SHA512 sobre HTTPS. Esto no verifica de forma independiente la identidad del editor. Si se incorpora un certificado, activa y prueba la comprobación de firma en instalador y actualizaciones. Protege la cuenta y permisos del repositorio: controlan el software que reciben los equipos.

## Recuperar una publicación interrumpida

Si el trabajo falla antes de publicar, corrige la causa y vuelve a ejecutarlo para la misma etiqueta desde Actions. Un borrador puede reutilizarse y completar sus archivos. Si la corrección cambia código, crea una versión y etiqueta nuevas.

El flujo rechaza modificar una Release ya publicada. No cambies sus ejecutables ni `latest.yml`: los equipos pueden haber almacenado hashes o descargas. Publica la corrección con un número superior.

Revisa los cuatro archivos y el resultado de Actions. Instala en un perfil de prueba y abre **Actualizaciones** desde la cabecera. Validar todo el ciclo de actualización requiere publicar una versión superior; una comprobación de “ya estás actualizado” no valida por sí sola la instalación.

Referencias: [GitHub CLI: crear una Release](https://cli.github.com/manual/gh_release_create), [etiquetas y ejecución manual de GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
