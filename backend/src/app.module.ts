import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DatabaseModule } from './db/database.module';
import { KafkaController } from './kafka.controller';
import { KafkaService } from './kafka.service';
import { StatsService } from './stats.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
  ],
  controllers: [AppController, KafkaController],
  providers: [KafkaService, StatsService],
})
export class AppModule {}
