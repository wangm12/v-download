import { normalizePythonFramework, findPythonFrameworks } from './normalize-python-framework.mjs'

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const frameworks = findPythonFrameworks(context.appOutDir)
  for (const framework of frameworks) {
    const result = normalizePythonFramework(framework)
    if (result.changed) {
      console.log(`Normalized Python.framework for codesign (${result.version}): ${framework}`)
    }
  }
}
