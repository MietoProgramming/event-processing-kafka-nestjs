import {
    Controller,
    Get,
    MessageEvent,
    Query,
    Sse,
} from '@nestjs/common';
import { Observable, catchError, from, interval, map, of, startWith, switchMap } from 'rxjs';
import { StatsService, type LatestEventRow, type StatsSnapshot } from './stats.service';

@Controller()
export class AppController {
  constructor(private readonly statsService: StatsService) {}

  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('events/latest')
  async getLatestEvents(@Query('limit') limit?: string): Promise<LatestEventRow[]> {
    const parsedLimit = Number(limit ?? 100);
    const effectiveLimit = Number.isFinite(parsedLimit) ? parsedLimit : 100;

    return this.statsService.getLatestEvents(effectiveLimit);
  }

  @Get('stats')
  async getStats(): Promise<StatsSnapshot> {
    return this.statsService.getSnapshot();
  }

  @Sse('stats/stream')
  streamStats(): Observable<MessageEvent> {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.statsService.getSnapshot())),
      map((snapshot: StatsSnapshot) => ({
        data: snapshot,
      })),
      catchError((error: Error) =>
        of({
          data: {
            error: error.message,
          },
        }),
      ),
    );
  }
}
