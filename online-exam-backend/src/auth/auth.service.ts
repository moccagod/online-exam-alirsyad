import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  private blacklistedTokens: Set<string> = new Set();

  blacklistToken(token: string) {
    this.blacklistedTokens.add(token);
  }

  isTokenBlacklisted(token: string): boolean {
    return this.blacklistedTokens.has(token);
  }

  /** ===========================
   * VALIDASI USER
   * ===========================
   */
  async validateUser(id: string, password: string, replacement?: string) {
    const userid = String(id ?? '').trim();
    const inputPassword = String(password ?? '').trim();
    const user = await this.usersService.getUserByNisNik(userid);

    if (!user) {
      throw new UnauthorizedException('User ID tidak terdaftar');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Akun tidak aktif');
    }

    if (!inputPassword) {
      throw new UnauthorizedException('Password tidak boleh kosong');
    }

    const isPasswordValid = bcrypt.compareSync(inputPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Password salah');
    }

    if (user.must_change_password && replacement) {
      const next = replacement.trim();
      if (next.length < 8 || Buffer.byteLength(next) > 72 || next === inputPassword) {
        throw new BadRequestException('Gunakan kata sandi baru minimal 8 karakter dan maksimal 72 byte.');
      }
      await this.usersService.replaceInitialPassword(user.id, user.password, next);
      user.must_change_password = false;
    }
    const { password: _, ...safeUser } = user;
    return safeUser;
  }

  /** ===========================
   * LOGIN
   * ===========================
   */
  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.userid, dto.password, dto.new_password);
    if (user.must_change_password) return { must_change_password: true };

    const payload = {
      sub: user.id,
      userid: user.userid,
      role: user.role,
      name: user.name,
      is_active: user.is_active,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  /** ===========================
   * LOGOUT
   * ===========================
   */
  async logout(token: string) {
    if (!token) return { message: 'No token provided' };

    this.blacklistToken(token);
    return { message: 'Logged out successfully' };
  }
}
