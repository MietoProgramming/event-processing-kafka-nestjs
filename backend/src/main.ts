import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import 'reflect-metadata';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const httpPort = Number(process.env.PORT ?? 3001);
  const instanceId = process.env.INSTANCE_ID ?? `backend-${httpPort}`;
  const kafkaBroker = process.env.KAFKA_BROKER ?? 'kafka:9092';
  const kafkaGroupId = process.env.KAFKA_GROUP_ID ?? 'analytics-consumer';
  const kafkaPostfixId = process.env.KAFKA_POSTFIX_ID ?? '';
  const kafkaClientIdBase = process.env.KAFKA_CLIENT_ID ?? 'analytics-consumer-client';
  const kafkaClientId = `${kafkaClientIdBase}-${instanceId}`;
  const kafkaTopics = (process.env.KAFKA_TOPICS ?? 'events.page_views,events.clicks,events.purchases')
    .split(',')
    .map((topic) => topic.trim())
    .filter((topic) => topic.length > 0);

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: '*',
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: kafkaClientId,
        brokers: [kafkaBroker],
      },
      consumer: {
        groupId: kafkaGroupId,
      },
      subscribe: {
        fromBeginning: false,
      },
      run: {
        autoCommit: true,
        partitionsConsumedConcurrently: 1,
      },
      postfixId: kafkaPostfixId,
    },
  });

  await app.startAllMicroservices();
  await app.listen(httpPort, '0.0.0.0');

  logger.log(`HTTP listening on :${httpPort}`);
  logger.log(`Kafka broker=${kafkaBroker} topics=${kafkaTopics.join(',')} groupId=${kafkaGroupId}`);
  logger.log(`Instance ID=${instanceId}`);
}

bootstrap();
