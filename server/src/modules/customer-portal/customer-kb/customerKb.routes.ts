import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { customerAuthMiddleware } from '../middleware/customerAuth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { CustomerOrg } from '../customer-org/customerOrg.model';
import { KbArticle } from '../../service-desk/models/kbArticle.model';
import { plain, tokens } from '../../ai/ai.service';

type CustomerRequest = Request & { customerUser?: { orgId: string } };

/** The staff workspace that serves this customer's knowledge base. */
async function workspaceFor(req: CustomerRequest): Promise<mongoose.Types.ObjectId> {
  const orgId = req.customerUser?.orgId;
  const org = orgId ? await CustomerOrg.findById(orgId).select('taskflowOrganizationId').lean() : null;
  if (!org?.taskflowOrganizationId) throw new ApiError(404, 'No knowledge base for this organisation');
  return org.taskflowOrganizationId as mongoose.Types.ObjectId;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return a.size ? n / a.size : 0;
}

const router = Router();
router.use(customerAuthMiddleware);

/** Suggest published articles for what the customer is typing (self-service before filing a request). */
router.get(
  '/search',
  asyncHandler(async (req: CustomerRequest, res) => {
    const q = String(req.query.q ?? '').slice(0, 300);
    const query = tokens(q);
    if (query.size < 1) {
      res.json({ success: true, data: [] });
      return;
    }
    const ws = await workspaceFor(req);
    const articles = await KbArticle.find({ taskflowOrganizationId: ws, published: true })
      .select('title body category')
      .limit(500)
      .lean();
    const data = articles
      .map((a) => {
        const body = plain(a.body, 4000);
        const score = overlap(query, tokens(`${a.title} ${a.title} ${body}`));
        return { _id: String(a._id), title: a.title, category: a.category, excerpt: body.slice(0, 220), score };
      })
      .filter((a) => a.score >= 0.34)
      .sort((x, y) => y.score - x.score)
      .slice(0, 5);
    res.json({ success: true, data });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: CustomerRequest, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new ApiError(404, 'Article not found');
    const ws = await workspaceFor(req);
    const article = await KbArticle.findOne({ _id: req.params.id, taskflowOrganizationId: ws, published: true })
      .select('title body category updatedAt')
      .lean();
    if (!article) throw new ApiError(404, 'Article not found');
    res.json({ success: true, data: article });
  })
);

export const customerKbRoutes = router;
