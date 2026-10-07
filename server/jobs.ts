// Lance le script d'analyse et garde ses événements (une ligne JSON par événement sur stdout).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface JobEvent {
  event: string;
  [key: string]: unknown;
}

type Listener = (event: JobEvent) => void;

export class Job {
  readonly id = randomUUID();
  readonly events: JobEvent[] = [];
  finished = false;
  private listeners = new Set<Listener>();
  private stdoutBuffer = '';
  private stderrTail = '';

  constructor(command: string, args: string[]) {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) this.handleLine(line);
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });

    child.on('error', (err) => this.finish({ event: 'error', message: `Impossible de lancer ${command} : ${err.message}` }));
    child.on('close', (code) => {
      if (this.stdoutBuffer.trim()) this.handleLine(this.stdoutBuffer);
      if (this.finished) return;
      const detail = this.stderrTail.trim().split('\n').slice(-3).join(' ');
      this.finish({ event: 'error', message: detail || `Le script s'est arrêté (code ${code})` });
    });
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as JobEvent;
      if (event.event === 'done' || event.event === 'error') this.finish(event);
      else this.push(event);
    } catch {
      // Ligne qui n'est pas du JSON : ignorée (sortie parasite d'une bibliothèque).
    }
  }

  private push(event: JobEvent) {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }

  private finish(event: JobEvent) {
    if (this.finished) return;
    this.finished = true;
    this.push(event);
  }

  /** Rejoue l'historique puis suit les nouveaux événements. Renvoie la fonction de désabonnement. */
  subscribe(listener: Listener): () => void {
    for (const event of this.events) listener(event);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class JobManager {
  private jobs = new Map<string, Job>();
  private current: Job | null = null;

  start(command: string, args: string[]): Job {
    if (this.current && !this.current.finished) throw new Error('Une analyse est déjà en cours');
    const job = new Job(command, args);
    this.jobs.set(job.id, job);
    this.current = job;
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }
}
