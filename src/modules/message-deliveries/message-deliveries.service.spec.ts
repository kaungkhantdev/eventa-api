import { DomainException } from '../../common/errors/domain.exception';
import { organizerAuth } from '../../../test/support/auth-context';
import {
  MessageDeliveriesRepository,
  type DeliveryRow,
} from './message-deliveries.repository';
import { MessageDeliveriesService } from './message-deliveries.service';

const auth = organizerAuth({ organizationId: 7, userId: 'actor-1' });

function delivery(id: string): DeliveryRow {
  return {
    id,
    kind: 'registration-confirmation',
    channel: 'email',
    recipientEmail: `r${id}@x.test`,
    recipientName: 'Anong Pattana',
    eventId: '1',
    eventName: 'Tech Summit 2026',
    status: 'sent',
    error: null,
    sentAt: new Date('2026-07-01T03:00:00Z'),
  };
}

describe('MessageDeliveriesService export (US-MSG-07)', () => {
  let repo: jest.Mocked<MessageDeliveriesRepository>;
  let service: MessageDeliveriesService;

  const matching = (rows: DeliveryRow[]) =>
    repo.list.mockResolvedValue({ rows, total: rows.length, failed: 0 });

  beforeEach(() => {
    repo = {
      list: jest.fn(),
      kinds: jest.fn(),
      recordExport: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MessageDeliveriesRepository>;
    service = new MessageDeliveriesService(repo);
  });

  it('tells the user there is nothing to export when the view is empty', async () => {
    matching([]);

    const err = await service
      .forExport(auth, { status: 'failed' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).getStatus()).toBe(409);
    expect((err as DomainException).message).toMatch(/nothing to export/);
  });

  it('records no export when nothing was exported', async () => {
    matching([]);
    await service.forExport(auth, {}).catch(() => undefined);
    expect(repo.recordExport).not.toHaveBeenCalled();
  });

  it('records the export for audit, naming who exported it', async () => {
    matching([delivery('1'), delivery('2')]);

    const rows = await service.forExport(auth, {});

    expect(rows).toHaveLength(2);
    expect(repo.recordExport).toHaveBeenCalledTimes(1);
    expect(repo.recordExport).toHaveBeenCalledWith(
      7,
      'actor-1',
      'Exported 2 delivery log rows',
    );
  });
});
