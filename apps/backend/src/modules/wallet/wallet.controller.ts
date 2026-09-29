import {
  Controller,
  Get,
  Param,
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
  GetTransactionDetailResponse,
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
  @ApiQuery({ name: 'type', required: false, enum: ['RECHARGE', 'CONSUME', 'REFUND', 'ADMIN_ADJUST'] })
  async getTransactions(
    @CurrentUser() user: User,
    @Query() query: GetTransactionsQueryDto,
  ): Promise<GetTransactionsResponse> {
    this.logger.log(
      `查询交易记录: userId=${user.id}, page=${query.page}, limit=${query.limit}`,
    );

    const { transactions, total } = await this.walletService.getUserTransactions(
      user.id,
      query.page || 1,
      query.limit || 20,
      query.type,
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

  @Get('transactions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '查询当前用户的账单详情' })
  async getTransactionDetail(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<GetTransactionDetailResponse> {
    this.logger.log(`查询账单详情: userId=${user.id}, transactionId=${id}`);
    return this.walletService.getUserTransactionDetail(user.id, id);
  }
}
