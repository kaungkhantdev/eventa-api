import {
  Injectable,
  NotFoundException,
  type PipeTransform,
} from '@nestjs/common';
import { EXPORT_FORMATS, type ExportFormat } from '../../common/export/tabular';

/**
 * The extension on an export route — `income.xlsx` (US-RPT-11).
 *
 * A 404 rather than a 422, because the format is part of the PATH: to a reader
 * who typed `income.json`, that route simply does not exist. A validation
 * error would suggest the request was nearly right.
 */
@Injectable()
export class ExportFormatPipe implements PipeTransform<string, ExportFormat> {
  transform(value: string): ExportFormat {
    const format = EXPORT_FORMATS.find((candidate) => candidate === value);
    if (!format) throw new NotFoundException('No such export format.');
    return format;
  }
}
