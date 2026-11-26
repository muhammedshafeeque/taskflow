import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../app';
import { env } from '../../config/env';
import { User } from '../auth/user.model';
import { CustomerUser } from '../customer-portal/customer-user/customerUser.model';
import { permissionsFor } from '../auth/accessProfile';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { getPlatformSettings } from '../platformSettings/platformSettings.service';
import { AppUpdate, UserUpdateAcknowledgement } from './appUpdate.model';

jest.mock('../auth/accessProfile', () => ({
  permissionsFor: jest.fn().mockResolvedValue([]),
}));

jest.mock('../platformSettings/platformSettings.service', () => ({
  getPlatformSettings: jest.fn().mockResolvedValue({ requireTwoFactor: false }),
}));

function signToken(sub: string, userType: 'taskflow' | 'customer' = 'taskflow'): string {
  return jwt.sign({ sub, userType, type: 'access' }, env.jwtSecret, { expiresIn: '1h' });
}

describe('Updates API routes & controller', () => {
  const userId = new mongoose.Types.ObjectId();
  const userCreatedAt = new Date('2026-11-20T00:00:00.000Z');

  beforeEach(() => {
    jest.spyOn(OrganizationMember, 'findOne').mockReturnValue({
      sort: () => ({ select: () => ({ lean: async () => null }) }),
    } as never);
    (permissionsFor as jest.Mock).mockResolvedValue([]);
    (getPlatformSettings as jest.Mock).mockResolvedValue({ requireTwoFactor: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(app).get('/api/updates/unseen').expect(401);
  });

  it('blocks customer portal users with 403', async () => {
    const customerId = new mongoose.Types.ObjectId();
    jest.spyOn(CustomerUser, 'findById').mockReturnValue({
      populate: () => ({
        lean: async () => ({
          _id: customerId,
          email: 'client@example.com',
          name: 'Client',
          customerOrgId: new mongoose.Types.ObjectId(),
          roleId: { permissions: [] },
          isOrgAdmin: false,
          status: 'active',
          mustChangePassword: false,
        }),
      }),
    } as never);

    const token = signToken(String(customerId), 'customer');
    await request(app)
      .get('/api/updates/unseen')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('returns unseen updates filtered by user createdAt and unacknowledged IDs', async () => {
    jest.spyOn(User, 'findById').mockImplementation((() => {
      const lean = async () => ({
        _id: userId,
        email: 'staff@example.com',
        name: 'Staff',
        role: 'user',
        enabled: true,
        mustChangePassword: false,
        createdAt: userCreatedAt,
      });
      return {
        select: () => ({ lean }),
        lean,
      };
    }) as never);

    jest.spyOn(UserUpdateAcknowledgement, 'find').mockReturnValue({
      select: () => ({
        lean: async () => [{ updateId: 'UPD-0001' }],
      }),
    } as never);

    const expectedUpdates = [
      {
        updateId: 'UPD-0002',
        date: '2026-11-26',
        type: 'feature',
        title: "What's New",
        details: 'Added modal ; Added sync',
      },
    ];

    const findMock = jest.spyOn(AppUpdate, 'find').mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: async () => expectedUpdates,
        }),
      }),
    } as never);

    const token = signToken(String(userId));
    const res = await request(app)
      .get('/api/updates/unseen')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(findMock).toHaveBeenCalledWith({
      createdAt: { $gt: userCreatedAt },
      updateId: { $nin: ['UPD-0001'] },
    });
    expect(res.body).toEqual({ success: true, data: expectedUpdates });
  });

  it('returns full changelog history on GET /api/updates', async () => {
    jest.spyOn(User, 'findById').mockReturnValue({
      lean: async () => ({
        _id: userId,
        email: 'staff@example.com',
        name: 'Staff',
        role: 'user',
        enabled: true,
        mustChangePassword: false,
      }),
    } as never);

    const history = [
      { updateId: 'UPD-0002', date: '2026-11-26', type: 'feature', title: 'B', details: 'D2' },
      { updateId: 'UPD-0001', date: '2026-11-25', type: 'fix', title: 'A', details: 'D1' },
    ];
    jest.spyOn(AppUpdate, 'find').mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: async () => history,
        }),
      }),
    } as never);

    const token = signToken(String(userId));
    const res = await request(app)
      .get('/api/updates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ success: true, data: history });
  });

  it('validates updateIds and acknowledges idempotently for req.user.id only', async () => {
    jest.spyOn(User, 'findById').mockReturnValue({
      lean: async () => ({
        _id: userId,
        email: 'staff@example.com',
        name: 'Staff',
        role: 'user',
        enabled: true,
        mustChangePassword: false,
      }),
    } as never);

    jest.spyOn(AppUpdate, 'find').mockReturnValue({
      select: () => ({
        lean: async () => [{ updateId: 'UPD-0001' }],
      }),
    } as never);

    const bulkWriteMock = jest
      .spyOn(UserUpdateAcknowledgement, 'bulkWrite')
      .mockResolvedValue({} as never);

    const token = signToken(String(userId));

    // Empty array rejected
    await request(app)
      .post('/api/updates/acknowledge')
      .set('Authorization', `Bearer ${token}`)
      .send({ updateIds: [] })
      .expect(400);

    // Unknown updateId rejected
    await request(app)
      .post('/api/updates/acknowledge')
      .set('Authorization', `Bearer ${token}`)
      .send({ updateIds: ['UPD-0001', 'UPD-9999'] })
      .expect(400);

    expect(bulkWriteMock).not.toHaveBeenCalled();

    // Valid acknowledge deduplicates and uses req.user.id regardless of body.userId
    const res = await request(app)
      .post('/api/updates/acknowledge')
      .set('Authorization', `Bearer ${token}`)
      .send({ updateIds: ['UPD-0001', 'UPD-0001'], userId: String(new mongoose.Types.ObjectId()) })
      .expect(200);

    expect(res.body).toEqual({ success: true, data: { acknowledged: ['UPD-0001'] } });
    expect(bulkWriteMock).toHaveBeenCalledTimes(1);
    const ops = bulkWriteMock.mock.calls[0][0] as unknown as Array<{
      updateOne: { filter: { userId: mongoose.Types.ObjectId; updateId: string } };
    }>;
    expect(ops).toHaveLength(1);
    expect(String(ops[0].updateOne.filter.userId)).toBe(String(userId));
    expect(ops[0].updateOne.filter.updateId).toBe('UPD-0001');
  });
});
