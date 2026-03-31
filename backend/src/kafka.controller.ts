import { Controller, Inject } from '@nestjs/common';
import { Ctx, EventPattern, KafkaContext, Payload } from '@nestjs/microservices';
import { KafkaService, type KafkaPayloadValue } from './kafka.service';

@Controller()
export class KafkaController {
  constructor(@Inject(KafkaService) private readonly kafkaService: KafkaService) {}

  @EventPattern('events.page_views')
  async consumeEvent(
    @Payload() _payload: unknown,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    const message = context.getMessage();
    const payload: KafkaPayloadValue = {
      key: message.key ?? null,
      value: message.value ?? null,
    };

    await this.kafkaService.consumeEvent(payload, context);
  }
}
