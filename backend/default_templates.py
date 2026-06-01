POSH_DEFAULT_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="margin:0; padding:0; background-color:#f9fafb; font-family:Arial, sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0;">
    <tr>
      <td align="center">

        <!-- Main Container -->
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:8px; border:1px solid #eeeeee;">

          <!-- Header -->
          <tr>
            <td style="background:#fff7ed; color:#ea580c; padding:20px; text-align:center; font-size:20px; font-weight:bold;">
              Thank you for reaching out!
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="height:3px; background:#fb923c;"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:25px; color:#374151; font-size:15px; line-height:1.6;">
              
              <p>Hi <strong>{{ $json.name }}</strong>,</p>

              <p>
                We truly value your message and will get back to you within 72 hours. We look forward to connecting with you. Meanwhile, feel free to explore more on our website.
              </p>

              <!-- 🔥 URGENT CONTACT -->
              <table width="100%" cellpadding="12" cellspacing="0" style="margin:20px 0; background:#fff7ed; border-left:4px solid #fb923c; border-radius:6px;">
                <tr>
                  <td style="font-size:14px; color:#7c2d12;">
                    <strong>Need urgent assistance?</strong><br><br>
                    For urgent inquiries, please call or message us directly:<br><br>

                    📞 <a href="tel:+91 98240 09829" style="color:#ea580c; text-decoration:none; font-weight:bold;">
                      +91 98240 09829
                    </a><br>

                    📧 <a href="mailto:digital@dvconsulting.co.in" style="color:#ea580c; text-decoration:none; font-weight:bold;">
                      digital@dvconsulting.co.in
                    </a>
                  </td>
                </tr>
              </table>

              <!-- ✅ POSH DETAILS -->
              <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse:collapse; font-size:14px; margin-top:15px;">

                <!-- Title -->
                <tr>
                  <td colspan="2" style="background:#fff7ed; color:#ea580c; font-weight:bold; padding:10px; border-radius:6px;">
                    Inquiry Details
                  </td>
                </tr>

                <tr>
                  <td style="width:35%; color:#6b7280;">Name</td>
                  <td style="font-weight:bold;">{{ $json.name }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Email</td>
                  <td>
                    <a href="mailto:{{ $json.email }}" style="color:#ea580c; text-decoration:none;">
                      {{ $json.email }}
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Phone</td>
                  <td>
                    <a href="tel:{{ $json.phone }}" style="color:#ea580c; text-decoration:none;">
                    {{ $json.phone }}
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Company Name</td>
                  <td>{{ $json.company_name }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">City</td>
                  <td>{{ $json.city }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Services Interested In</td>
                  <td>{{ $json.services_interested_in }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Interested in POSH Training</td>
                  <td>{{ $json.posh_interest }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Training Mode</td>
                  <td>{{ $json.training_mode }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Number of Employees</td>
                  <td>{{ $json.number_of_employees }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Preferred Timeline</td>
                  <td>{{ $json.preferred_timeline }}</td>
                </tr>

                <!-- Message -->
                <tr>
                  <td colspan="2" style="padding-top:15px; color:#ea580c; font-weight:bold;">
                    Requirement Message
                  </td>
                </tr>

                <tr>
                  <td colspan="2" style="background:#f9fafb; padding:12px; border-radius:6px; line-height:1.5;">
                    {{ $json.requirement_message }}
                  </td>
                </tr>

              </table>

              <br>

              <p style="margin-bottom:0;">
                Best regards,<br>
                <strong style="color:#ea580c;">D&V Business Consulting</strong>
              </p>

            </td>
          </tr>

          <!-- Footer -->
  

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
"""

CONTACT_US_DEFAULT_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="margin:0; padding:0; background-color:#f9fafb; font-family:Arial, sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0;">
    <tr>
      <td align="center">

        <!-- Main Container -->
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:8px; border:1px solid #eeeeee;">

          <!-- Header -->
          <tr>
            <td style="background:#fff7ed; color:#ea580c; padding:20px; text-align:center; font-size:20px; font-weight:bold;">
              Thank you for reaching out!
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="height:3px; background:#fb923c;"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:25px; color:#374151; font-size:15px; line-height:1.6;">
              
              <p>Hi <strong>{{ $json.name }}</strong>,</p>

              <p>
                We truly value your message and will get back to you within 72 hours. We look forward to connecting with you. Meanwhile, feel free to explore more on our website.
              </p>

              <!-- 🔥 URGENT CONTACT -->
              <table width="100%" cellpadding="12" cellspacing="0" style="margin:20px 0; background:#fff7ed; border-left:4px solid #fb923c; border-radius:6px;">
                <tr>
                  <td style="font-size:14px; color:#7c2d12;">
                    <strong>Need urgent assistance?</strong><br><br>
                    For urgent inquiries, please call or message us directly:<br><br>

                    📞 <a href="tel:+91 98240 09829" style="color:#ea580c; text-decoration:none; font-weight:bold;">
                      +91 98240 09829
                    </a><br>

                    📧 <a href="mailto:digital@dvconsulting.co.in" style="color:#ea580c; text-decoration:none; font-weight:bold;">
                      digital@dvconsulting.co.in
                    </a>
                  </td>
                </tr>
              </table>

              <!-- ✅ BUSINESS DETAILS -->
              <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse:collapse; font-size:14px; margin-top:15px;">

                <!-- Title -->
                <tr>
                  <td colspan="2" style="background:#fff7ed; color:#ea580c; font-weight:bold; padding:10px; border-radius:6px;">
                    Contact Details
                  </td>
                </tr>

                <tr>
                  <td style="width:35%; color:#6b7280;">Name</td>
                  <td style="font-weight:bold;">{{ $json.name }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Email</td>
                  <td>
                    <a href="mailto:{{ $json.email }}" style="color:#ea580c; text-decoration:none;">
                      {{ $json.email }}
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Phone</td>
                  <td>
                    <a href="tel:{{ $json.phone }}" style="color:#ea580c; text-decoration:none;">
                     {{ $json.phone }}
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Company Name</td>
                  <td>{{ $json.company_name }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">City</td>
                  <td>{{ $json.city }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Website</td>
                  <td>
                    <a href="{{ $json.website }}" style="color:#ea580c; text-decoration:none;">
                      {{ $json.website }}
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Turnover</td>
                  <td>{{ $json.turnover }}</td>
                </tr>

                <tr>
                  <td style="color:#6b7280;">Employee Size</td>
                  <td>{{ $json.employee_size }}</td>
                </tr>

                <!-- Message -->
                <tr>
                  <td colspan="2" style="padding-top:15px; color:#ea580c; font-weight:bold;">
                    Requirement Message
                  </td>
                </tr>

                <tr>
                  <td colspan="2" style="background:#f9fafb; padding:12px; border-radius:6px; line-height:1.5;">
                  {{ $json.requirement_message }}  
                  </td>
                </tr>

              </table>

              <br>

              <p style="margin-bottom:0;">
                Best regards,<br>
                <strong style="color:#ea580c;">D&V Business Consulting</strong>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
"""
