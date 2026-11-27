import { Controller, Post, Body, Req, BadRequestException, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('incident')
  incident(@Body() body: any) {
    if (!/^[A-Z0-9]{6,16}$/.test(String(body.code)) ||
      !['jadwal','mulai','kirim','halaman ujian','login/dashboard','login'].includes(body.stage) ||
      !['Chrome Android','iPhone','Chrome','Lainnya'].includes(body.browser)) throw new BadRequestException();
    Logger.warn({code:body.code,stage:body.stage,browser:body.browser},'PortalUjian');
    return {received:true};
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Supabase tidak memakai JWT guard seperti Passport, 
  // maka logout hanya menghapus token di client atau service
  @Post('logout')
  async logout(@Req() req) {
    const token = req.headers.authorization?.split(' ')[1];
    return this.authService.logout(token);
  }
}
