import { Router } from 'express';
import { authRouter } from './auth.js';
import { orgRouter } from './org.js';
import { auditSetupRouter } from './auditSetup.js';
import { peopleRouter } from './people.js';
import { rolesRouter } from './roles.js';
import { classificationRouter } from './classification.js';
import { auditsRouter } from './audits.js';
import { executionRouter } from './execution.js';
import { findingsRouter } from './findings.js';
import { capaRouter } from './capa.js';
import { analyticsRouter } from './analytics.js';
import { reportsRouter } from './reports.js';
import { notificationsRouter } from './notifications.js';
import { documentsRouter } from './documents.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/org', orgRouter);
apiRouter.use('/setup', auditSetupRouter);
apiRouter.use('/people', peopleRouter);
apiRouter.use('/roles', rolesRouter);
apiRouter.use('/classification', classificationRouter);
apiRouter.use('/audits', auditsRouter);
apiRouter.use('/findings', findingsRouter);
apiRouter.use('/capas', capaRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/', documentsRouter);
// Execution routes use fully-qualified paths (/audits/:id/execution, /matrix).
apiRouter.use('/', executionRouter);
