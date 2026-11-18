import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { spawn, execFileSync, ChildProcess } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'

/** Collected-mode worker owns the durable schedule; Nest owns only its process lifetime. */
@Injectable()
export class TimestampSchedulerService implements OnModuleInit, OnModuleDestroy {
  private child?: ChildProcess
  private restartTimer?: ReturnType<typeof setTimeout>
  private stopping = false
  private readonly logger = new Logger(TimestampSchedulerService.name)
  constructor(private readonly config: ConfigService) {}
  onModuleInit() {
    if (this.child || this.restartTimer || this.stopping || this.config.get('WORKBENCH_READ_MODE') !== 'local' || this.config.get('FOP_QUERIES_PAUSED') !== 'false'
      || this.config.get('WORKBENCH_MOCK_ENABLED') === 'true'
      || ['WORKBENCH_COLLECTED_ENABLED', 'WORKBENCH_AUTOMATIC_CALLS_ENABLED', 'WORKBENCH_SYNC_ENABLED', 'WORKBENCH_TIMESTAMP_SYNC_ENABLED'].some(key => this.config.get(key) !== 'true')) return
    // Accept only the known script inside the actual project, including symlink resolution.
    const roots = [resolve(__dirname, '../../../../..'), resolve(__dirname, '../../../..')]
    const root = roots.find(path => existsSync(resolve(path, 'scripts/workbench-scheduled-sync.mjs')) && existsSync(resolve(path, 'backend/package.json')))
    if (!root) {
      if(this.config.get('NODE_ENV')==='production')throw Error('timestamp_production_worker_missing')
      this.logger.warn('Timestamp scheduler files unavailable; no upstream calls started'); return
    }
    const script = resolve(this.config.get<string>('WORKBENCH_TIMESTAMP_WORKER_PATH') || resolve(root, 'scripts/workbench-scheduled-sync.mjs'))
    try {
      const actualRoot = realpathSync(root), actualScript = realpathSync(script), rel = relative(actualRoot, actualScript)
      if (isAbsolute(rel) || rel !== 'scripts/workbench-scheduled-sync.mjs') throw Error('worker_path_invalid')
      if(this.config.get('NODE_ENV')==='production'){
        const report=JSON.parse(execFileSync(process.execPath,[actualScript],{cwd:actualRoot,env:process.env,timeout:15000,encoding:'utf8',stdio:['ignore','pipe','pipe']}))
        if(report.executable!==true)throw Error('timestamp_production_preflight_failed')
      }
      const heap=Number(this.config.get('WORKBENCH_TIMESTAMP_WORKER_HEAP_MB')??8192)
      if(!Number.isInteger(heap)||heap<1024||heap>16384)throw Error('timestamp_worker_heap_invalid')
      // Full reconciliation builds the existing local graph. Isolate its bounded
      // heap from the HTTP server; the current test dataset exceeds Node's 4 GiB default.
      const child = spawn(process.execPath, [`--max-old-space-size=${heap}`, actualScript, '--watch'], { cwd: actualRoot, stdio: ['ignore','inherit','inherit'], detached: false,
        env: { ...process.env, WORKBENCH_SCHEDULE_PARENT_PID: String(process.pid) } })
      this.child = child
      child.once('error', () => { this.logger.error('Timestamp scheduler process unavailable'); if (this.child === child) this.child = undefined; this.scheduleRestart() })
      child.once('exit', () => { if (this.child === child) this.child = undefined; this.scheduleRestart() })
    } catch {
      if(this.config.get('NODE_ENV')==='production')throw Error('timestamp_production_preflight_failed')
      this.logger.error('Timestamp scheduler path/configuration unavailable; no upstream calls started')
    }
  }
  private scheduleRestart() {
    if (this.stopping || this.restartTimer) return
    this.logger.warn('Timestamp scheduler stopped; retry process in 30 minutes, retaining durable source schedule')
    this.restartTimer = setTimeout(() => { this.restartTimer = undefined; this.onModuleInit() }, 30 * 60 * 1000)
    this.restartTimer.unref()
  }
  async onModuleDestroy() {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    const child = this.child
    if (!child) return
    await new Promise<void>(done => {
      const timer = setTimeout(() => { child.kill('SIGKILL') }, 25000)
      child.once('exit', () => { clearTimeout(timer); done() })
      if (!child.kill('SIGTERM')) { clearTimeout(timer); done() }
    })
    this.child = undefined
  }
}
