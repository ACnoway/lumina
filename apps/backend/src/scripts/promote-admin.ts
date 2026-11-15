import { PrismaClient, UserRole } from '@prisma/client';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('用法: pnpm admin:promote -- <email>');
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`未找到账号: ${email}`);
    if (user.role === UserRole.ADMIN) {
      console.log(`账号已是管理员: ${email}`);
      return;
    }

    const result = await prisma.user.updateMany({
      where: { id: user.id, role: UserRole.USER },
      data: { role: UserRole.ADMIN },
    });
    if (result.count !== 1) throw new Error('账号角色已变化，请重新检查后重试');
    console.log(`已将账号设为管理员: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '管理员初始化失败');
  process.exitCode = 1;
});
