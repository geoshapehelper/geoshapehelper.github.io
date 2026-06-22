// Promise-based, typed wrapper around the geoprocessing worker.
import type {
  CleanParams,
  ExportParams,
  GeoStats,
  IslandParams,
  MergePropsStrategy,
  ShapeFC,
  SimplifyParams,
  SmoothParams,
  WorkerRequest,
  WorkerResponse,
} from '../types';

type OkResponse = Extract<WorkerResponse, { ok: true }>;
type ByOp<O extends OkResponse['op']> = Extract<OkResponse, { op: O }>;
/** Omit that distributes across the request union (plain Omit collapses it). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class GeoClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: OkResponse) => void; reject: (e: Error) => void }>();
  private inflight = 0;
  /** Called with `true` when work starts and `false` when the queue drains. */
  onBusyChange?: (busy: boolean) => void;
  /** Called if the worker itself fails (e.g. fails to load). */
  onError?: (error: Error) => void;

  constructor() {
    this.worker = new Worker(new URL('./geoWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data;
      const entry = this.pending.get(res.id);
      if (!entry) return;
      this.pending.delete(res.id);
      this.inflight--;
      if (this.inflight === 0) this.onBusyChange?.(false);
      if (res.ok) entry.resolve(res);
      else entry.reject(new Error(res.error));
    };
    // If the worker crashes (e.g. throws while loading), don't leave the UI
    // spinning forever - fail every in-flight request and clear the busy state.
    this.worker.onerror = (e: ErrorEvent) => {
      const error = new Error(e.message || 'Geoprocessing worker crashed.');
      this.failAll(error);
      this.onError?.(error);
    };
    this.worker.onmessageerror = () => {
      const error = new Error('Could not deserialize a worker message.');
      this.failAll(error);
      this.onError?.(error);
    };
  }

  private failAll(error: Error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    this.inflight = 0;
    this.onBusyChange?.(false);
  }

  private request(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<OkResponse> {
    const id = ++this.seq;
    if (this.inflight === 0) this.onBusyChange?.(true);
    this.inflight++;
    return new Promise<OkResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  async stats(fc: ShapeFC): Promise<GeoStats> {
    const r = (await this.request({ op: 'stats', fc })) as ByOp<'stats'>;
    return r.stats;
  }

  async simplifyPreview(fc: ShapeFC, params: SimplifyParams): Promise<ByOp<'simplifyPreview'>> {
    return (await this.request({ op: 'simplifyPreview', fc, params })) as ByOp<'simplifyPreview'>;
  }

  async simplify(fc: ShapeFC, params: SimplifyParams, clean: CleanParams): Promise<ByOp<'simplify'>> {
    return (await this.request({ op: 'simplify', fc, params, clean })) as ByOp<'simplify'>;
  }

  async clean(fc: ShapeFC, params: CleanParams): Promise<ByOp<'clean'>> {
    return (await this.request({ op: 'clean', fc, params })) as ByOp<'clean'>;
  }

  async islands(fc: ShapeFC, params: IslandParams, clean: CleanParams): Promise<ByOp<'islands'>> {
    return (await this.request({ op: 'islands', fc, params, clean })) as ByOp<'islands'>;
  }

  async smooth(fc: ShapeFC, params: SmoothParams): Promise<ByOp<'smooth'>> {
    return (await this.request({ op: 'smooth', fc, params })) as ByOp<'smooth'>;
  }

  async merge(args: {
    fc: ShapeFC;
    selectedGids: string[];
    newName: string;
    nameField: string;
    propsStrategy: MergePropsStrategy;
    allowNonContiguous: boolean;
    clean: CleanParams;
  }): Promise<ByOp<'merge'>> {
    return (await this.request({ op: 'merge', ...args })) as ByOp<'merge'>;
  }

  async export(
    fc: ShapeFC,
    layerId: string | null,
    params: ExportParams,
  ): Promise<ByOp<'export'>> {
    return (await this.request({ op: 'export', fc, layerId, params })) as ByOp<'export'>;
  }
}
