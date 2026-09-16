import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { AdminController } from './admin.controller';
import { AuditController } from '../audit/audit.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

describe('Admin and audit authorization metadata', () => {
  it.each([AdminController, AuditController])(
    '%p requires an ADMIN or SUPER_ADMIN role',
    (controller) => {
      expect(Reflect.getMetadata('__guards__', controller)).toEqual(
        expect.arrayContaining([RolesGuard]),
      );
      expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual(ADMIN_ROLES);
    },
  );
});
