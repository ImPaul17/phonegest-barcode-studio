import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const target=path.join(root,'THIRD-PARTY-NOTICES.txt');
const marker='\n\nADDITIONAL RUNTIME PACKAGES FOR IN-APP UPDATES\n';
const original=(await readFile(target,'utf8')).split(marker)[0].replace(/^Version: .+$/m,`Version: ${JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version}`);
const npmCli=process.env.npm_execpath || path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const packagePaths=execFileSync(process.execPath,[npmCli,'ls','--omit=dev','--all','--parseable'],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim().split(/\r?\n/).filter(dir=>dir!==root);
const oldNames=new Set(['react','react-dom','scheduler','jsbarcode','lucide-react','@fontsource/inter','sharp','@img/sharp-win32-x64','@img/colour','detect-libc','semver']);
const sections=[];
for(const directory of packagePaths){
  const info=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
  if(oldNames.has(info.name))continue;
  const files=(await readdir(directory)).filter(file=>/^(?:licen[sc]e|copying|notice)(?:$|[.\-_])/i.test(file));
  const texts=[];
  for(const file of files){try{texts.push(`${file}:\n${await readFile(path.join(directory,file),'utf8')}`);}catch{}}
  if(!texts.length && info.license==='MIT'){
    const mit=await readFile(path.join(root,'node_modules','electron-updater','LICENSE'),'utf8');
    texts.push(`The package declares the MIT license in package.json.\nAuthor: ${typeof info.author==='string'?info.author:JSON.stringify(info.author)}\n\n${mit.slice(mit.indexOf('Permission is hereby granted'))}`);
  }
  if(!texts.length)throw new Error(`No license file found for ${info.name}@${info.version}`);
  sections.push(`\n${'='.repeat(78)}\n${info.name} ${info.version}\nLicense: ${typeof info.license==='string'?info.license:JSON.stringify(info.license)}\nProject: ${info.homepage || info.repository?.url || ''}\n\n${texts.join('\n\n')}`);
}
await writeFile(target,original+marker+sections.join('\n'),'utf8');
console.log(`Updated runtime notices: ${sections.length} additional package licenses.`);
