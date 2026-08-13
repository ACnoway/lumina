import {
  Controller,
  Get,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { GetTransactionsQueryDto } from './dto/wallet.dto';
import {
  GetBalanceResponse,
  GetTransactionsResponse,
  TransactionItem,
} from '@lumina/shared';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(private readonly walletService: WalletService) {}

  /**
   * 获取当前用户余额
   */
  @Get('balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户余额' })
  async getBalance(@CurrentUser() user: User): Promise<GetBalanceResponse> {
    this.logger.log(`获取余额: userId=${user.id}`);

    const wallet = await this.walletService.getWallet(user.id);

    return {
      balance: parseFloat(wallet.balance.toString()),
      walletId: wallet.id,
    };
  }

  /**
   * 分页查询交易记录
   */
  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '分页查询交易记录' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  async getTransactions(
    @CurrentUser() user: User,
    @Query() query: GetTransactionsQueryDto,
  ): Promise<GetTransactionsResponse> {
    this.logger.log(
      `查询交易记录: userId=${user.id}, page=${query.page}, limit=${query.limit}`,
    );

    const { transactions, total } = await this.walletService.getTransactions(
      user.id,
      query.page || 1,
      query.limit || 20,
    );

    const items: TransactionItem[] = transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: parseFloat(tx.amount.toString()),
      balance: parseFloat(tx.balance.toString()),
      reason: tx.reason,
      createdAt: tx.createdAt.toISOString(),
      metadata: tx.metadata as any,
    }));

    return {
      items,
      total,
      page: query.page || 1,
      limit: query.limit || 20,
      totalPages: Math.ceil(total / (query.limit || 20)),
    };
  }
}
