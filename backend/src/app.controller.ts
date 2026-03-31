import {
    Controller,
    DefaultValuePipe,
    Get,
    Inject,
    MessageEvent,
    ParseIntPipe,
    Query,
    Sse,
} from '@nestjs/common';
import { Observable, catchError, from, interval, map, of, startWith, switchMap } from 'rxjs';
import {
    StatsService,
    type DashboardAnalyticsSnapshot,
    type LatestEventRow,
    type StatsSnapshot,
} from './stats.service';

@Controller()
export class AppController {
  constructor(@Inject(StatsService) private readonly statsService: StatsService) {}

  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('events/latest')
  async getLatestEvents(
    @Query('limit') limit?: string,
    @Query('processedBy') processedBy?: string,
  ): Promise<LatestEventRow[]> {
    const parsedLimit = Number(limit ?? 100);
    const effectiveLimit = Number.isFinite(parsedLimit) ? parsedLimit : 100;

    return this.statsService.getLatestEvents(effectiveLimit, processedBy);
  }

  @Get('dashboard/analytics')
  async getDashboardAnalytics(
    @Query('windowMinutes', new DefaultValuePipe(15), ParseIntPipe) windowMinutes: number,
    @Query('bucketSeconds', new DefaultValuePipe(10), ParseIntPipe) bucketSeconds: number,
    @Query('processedBy') processedBy?: string,
  ): Promise<DashboardAnalyticsSnapshot> {
    return this.statsService.getDashboardAnalytics({
      windowMinutes,
      bucketSeconds,
      processedBy,
    });
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
