import { IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  userid: string;

  @IsOptional()
  @IsString()
  new_password?: string;

  @IsString()
  password: string;
}
