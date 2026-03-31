import { Controller, Inject } from '@nestjs/common';
import { Ctx, EventPattern, KafkaContext, Payload } from '@nestjs/microservices';
import { KafkaService, type KafkaPayloadValue } from './kafka.service';

@Controller()
export class KafkaController {
  constructor(@Inject(KafkaService) private readonly kafkaService: KafkaService) {}

  @EventPattern('events.page_views')
  async consumePageViews(
    @Payload() _payload: unknown,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    await this.consumeKafkaMessage(context);
  }

  @EventPattern('events.clicks')
  async consumeClicks(
    @Payload() _payload: unknown,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    await this.consumeKafkaMessage(context);
  }

  @EventPattern('events.purchases')
  async consumePurchases(
    @Payload() _payload: unknown,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    await this.consumeKafkaMessage(context);
  }

  private async consumeKafkaMessage(context: KafkaContext): Promise<void> {
    const message = context.getMessage();
    const payload: KafkaPayloadValue = {
      topic: context.getTopic(),
      partition: context.getPartition(),
      key: message.key ?? null,
      value: message.value ?? null,
    };

    await this.kafkaService.consumeEvent(payload);
  }
}
