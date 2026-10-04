# ដាក់ Studio លើ VPS ដើម្បីប្រើលើទូរស័ព្ទ

បន្ទាប់ពីដាក់លើ VPS រួច អ្នកអាចបើក Studio ពីទូរស័ព្ទ ឬកុំព្យូទ័រណាមួយ គ្រប់ទីកន្លែង តាម Browser ដោយមិនចាំបាច់បើកកុំព្យូទ័រនៅផ្ទះ។

> **សុវត្ថិភាព៖** ពេលដំណើរការក្នុង Docker កម្មវិធីបើក **Server Mode** ដោយស្វ័យប្រវត្ត៖
> - ត្រូវចូលគណនីទើបប្រើបាន
> - មានតែ Admin ទេ ដែលអាចប្ដូរ API Key, Update កម្មវិធី, ឬលុបឯកសារទាំងអស់
> - ពាក្យសម្ងាត់ Admin ត្រូវកំណត់ផ្ទាល់ខ្លួនក្នុង `.env` (ពាក្យសម្ងាត់ដែលមានក្នុង code មិនអាចប្រើលើ Server ទេ)

---

## ១. ជួល VPS

| | អប្បបរមា | ណែនាំ |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| ថាស | 40 GB | 80 GB+ (វីដេអូស៊ីទំហំច្រើន) |
| ប្រព័ន្ធ | Ubuntu 22.04 / 24.04 | |

- Server នៅសិង្ហបុរី ល្បឿនលឿនសម្រាប់កម្ពុជា (ឧ. Vultr, DigitalOcean, Contabo, Hetzner…)។
- VPS គ្មាន GPU ក៏បាន៖ ការក្លូនសំឡេង VoxCPM2 នៅតែប្រើ Link ពី Google Colab ដដែល។
- Demucs (បំបែកភ្លេង) ដំណើរការលើ CPU យឺតបន្តិច (ប្រហែលច្រើននាទីសម្រាប់មួយភាគ)។

## ២. ដំឡើង (ធ្វើតែម្តង)

ចូល VPS តាម SSH រួចវាយ៖

```bash
# ដំឡើង Docker
curl -fsSL https://get.docker.com | sh

# ទាញ code
git clone https://github.com/saveitkh/BarameyDabber.git
cd BarameyDabber

# ការកំណត់
cp .env.example .env
nano .env
```

ក្នុង `.env` ត្រូវបំពេញយ៉ាងហោចណាស់៖

```
GEMINI_API_KEY=AQ.xxxxxxxx
STUDIO_ADMIN_PASSWORD=ពាក្យសម្ងាត់វែងៗរបស់អ្នក
```

## ៣. ចាប់ផ្ដើម

### ក. គ្មាន Domain (ងាយបំផុត)

```bash
docker compose up -d --build
sudo ufw allow 3000   # បើក Firewall បើមាន
```

បើកលើទូរស័ព្ទ៖ `http://IP-របស់-VPS:3000`

### ខ. មាន Domain + HTTPS (ណែនាំ)

1. ក្នុង DNS របស់ Domain បង្កើត **A record** ឲ្យ `dub.yourdomain.com` ចង្អុលទៅ IP របស់ VPS។
2. ក្នុង `.env` បន្ថែម `DOMAIN=dub.yourdomain.com`
3. ដំណើរការ៖

```bash
sudo ufw allow 80 && sudo ufw allow 443
docker compose -f docker-compose.vps.yml up -d --build
```

បើកលើទូរស័ព្ទ៖ `https://dub.yourdomain.com` (HTTPS ត្រូវបានរៀបចំដោយស្វ័យប្រវត្ត)

**ដាក់លើអេក្រង់ទូរស័ព្ទដូច App៖** Chrome → ⋮ → «Add to Home screen» (iPhone: Safari → Share → «Add to Home Screen»)។

## ៤. គណនី

- **Admin**៖ ចូលដោយ Email Admin និង `STUDIO_ADMIN_PASSWORD`។
- **ចុះឈ្មោះ**៖ លើ Server ការចុះឈ្មោះត្រូវបានបិទ ដើម្បីកុំឲ្យអ្នកដទៃប្រើ Gemini Quota របស់អ្នក។ ដើម្បីបន្ថែមអ្នកប្រើ៖
  1. ដាក់ `STUDIO_ALLOW_REGISTER=1` ក្នុង `.env` → `docker compose up -d`
  2. ឲ្យគេចុះឈ្មោះ
  3. ដាក់ `STUDIO_ALLOW_REGISTER=0` វិញ → `docker compose up -d`
  4. ផ្ដល់ License ក្នុង «ផ្ទាំងគ្រប់គ្រង Admin»
- **១ គណនី = ១ ឧបករណ៍**៖ ចូលលើទូរស័ព្ទ នឹងចាកចេញពីកុំព្យូទ័រ (និងផ្ទុយមកវិញ)។

## ៥. Update កម្មវិធី

```bash
cd BarameyDabber
git pull
docker compose up -d --build        # ឬ: docker compose -f docker-compose.vps.yml up -d --build
```

វីដេអូ គណនី និងសំឡេងតួ (`data/`, `uploads/`, `outputs/`, `samples/`) មិនបាត់ទេ។
សូមកុំប្រើប៊ូតុង Update ក្នុងកម្មវិធីលើ Server ទេ ប្រើ `git pull` ជំនួសវិញ។

## ៦. ពិនិត្យបញ្ហា

```bash
docker compose logs -f --tail=100     # មើល Log
docker compose restart                # Restart
df -h                                 # ពិនិត្យទំហំថាស
```

ពេលថាសជិតពេញ សូមចូល «ការកំណត់ → កម្រិតខ្ពស់ → សម្អាតឯកសារ Output»។
