import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
const config = {root:resolve(import.meta.dirname),plugins:[react()],resolve:{alias:{'@':resolve(import.meta.dirname,'../../..')}},build:{outDir:resolve(import.meta.dirname,'../../../../../outputs/clean-aptitude'),emptyOutDir:true}}

export default config
