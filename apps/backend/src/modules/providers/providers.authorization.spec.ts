import 'reflect-metadata';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ProvidersController } from './providers.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

function createContext(
  handler: () => void,
  user?: { role: UserRole },
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ProvidersController,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard and provider authorization', () => {
  it('returns 401 when a protected request has no authenticated user', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(ROLES_KEY, ADMIN_ROLES, handler);
    const guard = new RolesGuard(new Reflector());

    expect(() => guard.canActivate(createContext(handler))).toThrow(
      UnauthorizedException,
    );
  });

  it('returns 403 for USER and allows ADMIN and SUPER_ADMIN', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(ROLES_KEY, ADMIN_ROLES, handler);
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(createContext(handler, { role: UserRole.USER })),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(createContext(handler, { role: UserRole.ADMIN })),
    ).toBe(true);
    expect(
      guard.canActivate(createContext(handler, { role: UserRole.SUPER_ADMIN })),
    ).toBe(true);
  });

  it('protects every provider/model/upstream mutation and sensitive provider reads', () => {
    const protectedMethods = [
      'createPlatformModel',
      'updatePlatformModel',
      'deletePlatformModel',
      'getProviders',
      'createProvider',
      'updateProvider',
      'deleteProvider',
      'getUpstreamsForPlatformModel',
      'addUpstreamModel',
      'updateUpstreamModel',
      'removeUpstreamModel',
    ] as const;

    for (const methodName of protectedMethods) {
      const method = ProvidersController.prototype[methodName];
      expect(Reflect.getMetadata('__guards__', method)).toEqual(
        expect.arrayContaining([RolesGuard]),
      );
      expect(Reflect.getMetadata(ROLES_KEY, method)).toEqual(ADMIN_ROLES);
    }
  });
});
