# PhoneGest Barcode Studio

Aplicación web y de Windows para generar, organizar, imprimir y exportar códigos de barras Code 128 para uso interno de PhoneGest. Incluye el logo negro de PhoneGest y un documento A4 con identificadores, numeración y casillas para marcar paquetes.

La generación, la vista previa, las exportaciones y la impresión se realizan en el equipo. Los identificadores, proyectos y exportaciones se procesan localmente. Los usuarios pueden abrir la web en el navegador o usar el ejecutable de Windows con su entorno de ejecución incluido.

## Abrir la edición web

Abre [PhoneGest Barcode Studio en GitHub Pages](https://impaul17.github.io/phonegest-barcode-studio/). Una vez cargada, la aplicación trabaja con los códigos en el navegador. La sesión se guarda en ese navegador. Exporta un proyecto `.pgbs` para conservar una copia o llevarlo a otro navegador o a Windows.

**Guardar como PDF** abre el diálogo de impresión. Elige ese destino, tamaño **A4** y escala **100 %**. La exportación de imágenes descarga un PNG para un código o un ZIP para varios. Para pegar, puedes usar `Ctrl+V` si el navegador no concede acceso al portapapeles.

## Instalar o ejecutar en Windows

Descarga los ejecutables desde [GitHub Releases](https://github.com/ImPaul17/phonegest-barcode-studio/releases/latest). Destinado a **Windows 10/11 de 64 bits (x64)**. Se generan dos variantes en `release/`:

| Archivo | Uso |
| --- | --- |
| `PhoneGest-Barcode-Studio-1.0.4c-Instalador.exe` | Instala la versión **1.0.4c**, crea accesos y permite actualizar desde la aplicación. |
| `PhoneGest-Barcode-Studio-1.0.4c-Portable.exe` | Abre **1.0.4c** sin instalar. Para actualizar, descarga y ejecuta un portable nuevo. |

El número de versión del nombre cambia en cada publicación. Ambas variantes trabajan offline y guardan la sesión en el perfil del usuario de Windows. La edición portable también utiliza ese perfil; los datos de trabajo no viajan dentro del ejecutable.

La versión actual es **1.0.4c**, tanto en el código y la aplicación como en el instalador y el actualizador. Su única tag de publicación es **`v1.0.4c`**. Las mejoras pequeñas siguen con **1.0.4d**, **1.0.4e**, etc., sin cambiar la base **1.0.4** ni utilizar otra versión interna.

Los ejecutables actuales no tienen certificado de firma digital. Windows puede identificar al editor como desconocido. Utiliza los archivos del repositorio de PhoneGest enlazado arriba.

## Actualizaciones de Windows

**Para pasar desde una versión anterior a 1.0.4c, descarga y ejecuta una vez el instalador 1.0.4c desde GitHub Releases.** Los actualizadores anteriores solo admiten versiones numéricas y no pueden hacer automáticamente esta transición al formato con letras. La edición portable se cambia descargando el portable nuevo.

Desde **1.0.4c**, la aplicación instalada compara directamente versiones como **1.0.4c**, **1.0.4d** y **1.0.4e**. Consulta las versiones estables de este repositorio poco después de iniciarse y cada cuatro horas mientras permanece abierta. Descarga las versiones nuevas en segundo plano y espera a que elijas **Reiniciar e instalar**. Antes de reiniciar guarda la sesión actual; cerrar normalmente la aplicación no instala una descarga pendiente.

Abre el menú **Actualizaciones** desde su botón en la cabecera para ver la versión instalada, el estado y el progreso, o pulsa **Buscar actualizaciones**. Cuando hay una versión nueva aparece un aviso debajo de la cabecera; al ocultarlo, el indicador del botón permanece visible y el aviso vuelve a aparecer cuando está lista para instalar. Si no hay conexión, puedes seguir trabajando con tus códigos. La edición portable ofrece **Abrir descargas** para conseguir una versión nueva.

El origen es el repositorio público `ImPaul17/phonegest-barcode-studio` y la infraestructura de archivos de GitHub. No se necesita cuenta ni token de GitHub en el equipo del usuario. GitHub recibe las solicitudes habituales de conexión y descarga, incluidos la dirección IP y los datos técnicos de HTTP; no recibe códigos, proyectos, PDF ni imágenes de trabajo.

## Uso

1. Escribe o pega un identificador por línea y pulsa **Añadir códigos**. También puedes usar **Pegar** o probar los ejemplos incluidos.
2. Edita, elimina y ordena los códigos desde la lista. Puedes arrastrar las filas o usar sus botones de movimiento.
3. Comprueba la vista previa y ajusta el documento desde **Configuración**: distribución, número inicial, texto visible, numeración, casillas y título opcional.
4. Pulsa **Generar PDF**, **Imprimir** o **Exportar imágenes**. La exportación genera una etiqueta PNG por identificador a 300 ppp. En Windows se guardan en la carpeta elegida.
5. Guarda un proyecto para recuperar el lote y sus opciones más adelante.

La distribución predeterminada es **PhoneGest · 4 por página**. También están disponibles **Compacto · 7 por página** y **Amplio · 2 por página**. Los documentos mantienen el logo negro, la numeración continua y las casillas según la configuración elegida. La vista previa se actualiza al cambiar códigos u opciones. El modo claro, oscuro o del sistema afecta a la interfaz; el documento conserva el fondo blanco para imprimir.

Ejemplos válidos:

```text
PG-ENVIO-001
PG-ENVIO-002
PG-ENVIO-003
```

### Validación

- Code 128 admite letras mayúsculas y minúsculas, números y símbolos ASCII imprimibles. Se conserva exactamente la capitalización y los espacios interiores.
- Máximo de **45 caracteres por identificador** y **1.000 códigos por documento**.
- Se omiten las líneas vacías y se quitan los espacios al principio y al final de cada línea pegada.
- Las tildes, otros caracteres Unicode y los caracteres de control se rechazan. Si el lote contiene errores, el texto permanece disponible para corregirlo.
- Los duplicados se indican y **se conservan**, para permitir varias etiquetas con el mismo código.

### Atajos

| Atajo | Acción |
| --- | --- |
| `Ctrl+Enter` | Añadir los códigos del campo de entrada. |
| `Ctrl+O` | Abrir proyecto. |
| `Ctrl+S` | Guardar proyecto. |
| `Ctrl+P` | Imprimir. |
| `Ctrl+Shift+E` | Generar PDF. |
| `Ctrl+Z` | Deshacer cambios de la lista cuando el foco está fuera de los campos de texto. |

El botón **Deshacer** conserva hasta 20 cambios de la lista durante la sesión abierta.

## Datos locales y proyectos

En Windows, la sesión se guarda automáticamente en la carpeta de datos de la aplicación, normalmente:

```text
%APPDATA%\PhoneGest Barcode Studio\session.json
```

Incluye la lista, el borrador del campo de entrada, las opciones y el tema. La siguiente apertura recupera esos datos. El desinstalador conserva la carpeta de datos del usuario. Para empezar sin la sesión anterior, cierra el programa y elimina `session.json`.

Los proyectos **`.pgbs`** son archivos JSON de texto plano con los códigos y la configuración del documento. No están cifrados. Se guardan en la ubicación que elijas y permiten trasladar un lote a otro equipo. Los PDF, PNG y proyectos deben gestionarse con las mismas medidas de acceso que el resto de documentos internos de PhoneGest.

## Impresión y comprobación

La impresión abre el diálogo de Windows. Utiliza papel **A4**, orientación vertical y **escala real del 100 %**; evita que el controlador ajuste o reduzca el documento. Si un visor de PDF añade márgenes o escala automáticamente, revisa esas opciones antes de imprimir.

Las pruebas automáticas verifican códigos y exportaciones digitales con un lector independiente. **La impresión en una impresora física no se ha verificado.** Antes de usarlo en producción, imprime una muestra en la impresora de destino y comprueba con el lector habitual que el valor leído coincide exactamente con el identificador. La calidad de impresión, el papel y el controlador influyen en la lectura.

## Desarrollo

El código utiliza Electron, React y TypeScript. Los códigos se generan localmente con JsBarcode; el PDF se imprime desde el mismo documento vectorial utilizado en la vista previa. Sharp rasteriza las etiquetas PNG. Las fuentes Inter y los iconos Lucide se incluyen en la aplicación.

Para desarrollar y empaquetar se utiliza **Node.js 24 x64** y npm. La descarga inicial de dependencias y herramientas de empaquetado requiere conexión. El procesamiento de códigos del ejecutable terminado funciona offline.

Desde la raíz del repositorio:

```powershell
npm ci
npm run dev
```

En PowerShell puede utilizarse `npm.cmd` si la política local impide ejecutar `npm.ps1`.

| Comando | Resultado |
| --- | --- |
| `npm run dev` | Inicia Vite en `127.0.0.1:5173` y la ventana de Electron con recarga de desarrollo. |
| `npm run build` | Comprueba TypeScript y compila la interfaz en `dist/`. |
| `npm run dev:web` | Ejecuta la edición web con recarga de desarrollo. |
| `npm run build:web` | Genera la edición de GitHub Pages en `dist-web/`. |
| `npm run preview:web` | Sirve localmente la compilación web. |
| `npm run test:web` | Prueba la compilación web en Chromium. Prepara el navegador con `npx playwright install chromium`. |
| `npm start` | Abre con Electron la compilación existente de `dist/`. |
| `npm test` | Pruebas del motor, PNG, proyectos, acceso, actualizador y metadatos de publicación. |
| `npm run test:ui` | Ejecuta las pruebas de interfaz en Electron y guarda capturas en `artifacts/`; requiere una compilación actual en `dist/`. |
| `npm run smoke` | Compila y verifica exportaciones reales de PDF, PNG y proyecto en `build/smoke/`. |
| `npm run package -- --publish never` | Genera instalador NSIS y portable x64 en `release/`, sin publicar. |
| `npm run package:dir` | Genera la carpeta ejecutable `release/win-unpacked/`, útil para revisar el paquete. |
| `npm run test:pdf` | Lee los PDF del smoke con PDF.js y ZXing a 300 ppp. |
| `npm run test:png` | Lee los PNG del smoke y comprueba tamaño, resolución y logo. |
| `npm run release:validate` | Comprueba SHA512, tamaños, blockmap y archivos del actualizador. |

Secuencia recomendada para preparar una distribución:

```powershell
npm ci
npm run build
npm test
npm run test:ui
npm run smoke
npm run test:pdf
npm run test:png
npm run package -- --publish never
npm run release:validate
```

Los usuarios finales reciben el instalador o el portable. No necesitan el repositorio ni `node_modules`. La carpeta `win-unpacked` debe conservarse completa si se utiliza para probar o distribuir esa variante. Mantén los avisos de terceros y las licencias que acompañan al paquete.

La configuración base de empaquetado está en `electron-builder.yml`; `electron-builder.config.cjs` conserva la versión con letra y adapta los campos numéricos que exige Windows. `shared/` contiene el motor; `electron/`, archivos, impresión y actualizaciones; `src/`, la interfaz. Los datos de trabajo, PDF originales, proyectos y resultados de pruebas no forman parte del repositorio ni del paquete.

## Publicar una versión

Los cambios de `main` pasan comprobaciones en Windows y el flujo [Publicar edición web](.github/workflows/pages.yml) despliega la compilación web en GitHub Pages tras probarla en Chromium. Una etiqueta como **`v1.0.4c`**, que coincida exactamente con `package.json.version`, ejecuta la publicación de Windows y sube juntos el instalador, su `.blockmap`, `latest.yml` y el portable a GitHub Releases. La misma versión, incluida su letra, identifica el código, la aplicación y sus archivos.

Consulta [docs/RELEASING.md](docs/RELEASING.md) para preparar una versión y recuperar una publicación interrumpida. No reemplaces archivos de una versión publicada: avanza la letra de revisión o la versión base para mantener coherentes los clientes que ya la descargaron.

## Créditos y licencias

PhoneGest conserva los derechos sobre su nombre, logo e identidad visual. Los componentes de terceros mantienen sus propias licencias, reproducidas en [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt). Electron incluye además `LICENSE.electron.txt` y `LICENSES.chromium.html` en su distribución.

La referencia a barcodees.com sirvió para orientar el alcance funcional solicitado. Este proyecto no está afiliado ni avalado por ese servicio y genera los códigos íntegramente en local.
